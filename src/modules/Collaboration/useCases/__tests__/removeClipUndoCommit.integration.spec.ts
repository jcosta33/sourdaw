import { change, clone, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';
import {
    gainEnvelopeStore,
    setWarpState,
    takeLaneStore,
    trackStore,
    warpStateStore,
} from '#/modules/Arrangement/stores';
import { addClip, addGainEnvelopePoint, addTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane, restoreAutomationLanes } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { AutomergeSync } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = {
    tracks: { tracks: Array<{ id: string; clips: Array<{ id: string; name: string }> }> };
    midi: NonNullable<typeof midiStore.value>;
    automation: NonNullable<typeof automationStore.value>;
    gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
    warpStates: NonNullable<typeof warpStateStore.value>;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function document(): Doc<Project> {
    const current = getCrdtDoc<Project>('root');
    if (!current) {
        throw new Error('Expected the live project');
    }
    return current;
}

function owners(): string[][] {
    return document().tracks.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, clip.name]));
}

function projectedOwners(): string[][] {
    return (trackStore.value?.tracks ?? []).flatMap((track) => track.clips.map((clip) => [clip.id, clip.name]));
}

describe('committed clip restoration through Command and real peer sync', () => {
    let stopProjection = () => {};
    const cleanups: Array<() => void> = [];
    let sourceSnapshot: NonNullable<ReturnType<typeof addClip>>;

    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip restore commit integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjection = setupProjectionBridge();
        projectCrdtToStores();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        addTrack({ id: 'track-1', kind: 'audio', name: 'Track', suppressAddedEvent: true });
        addClip({ id: 'source', trackId: 'track-1', name: 'Source', startBeat: 0, endBeat: 4 });
        addClip({ id: 'survivor', trackId: 'track-1', name: 'Survivor', startBeat: 8, endBeat: 12 });
        flushAutomergeStorageWrites();
        const source = trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'source');
        if (!source) {
            throw new Error('Expected the seeded source');
        }
        sourceSnapshot = structuredClone(source);
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'source', ripple: false } });
        expect(owners()).toEqual([['survivor', 'Survivor']]);
        expect(projectedOwners()).toEqual(owners());
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) {
            cleanup();
        }
        clearUndoHistory();
        clearHandlerRegistry();
        resetActionReplayAuthority();
        stopProjection();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it.each(['none', 'published-rename', 'concurrent-rename', 'recreated', 'identically-recreated'] as const)(
        'keeps document, projection and Undo history consistent with %s',
        async (mode) => {
            const entry = undoHistoryStore.value?.past[0];
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreClip') {
                throw new Error('Expected the real removal inverse');
            }
            const captured = structuredClone(entry.inverseAction.payload.clipSnapshot);
            const baseline = document();
            const peer = change(clone(baseline, 'bbbbbbbbbbbbbbbb'), (draft) => {
                const track = draft.tracks.tracks[0];
                if (!track) {
                    throw new Error('Expected the peer track');
                }
                if (mode === 'recreated' || mode === 'identically-recreated') {
                    track.clips.unshift({ ...captured, name: mode === 'recreated' ? 'Peer source' : 'Source' });
                } else {
                    track.clips[0]!.name = 'Peer survivor';
                }
            });
            let applied = false;
            let stagedBeforePublication = false;
            cleanups.push(
                trackStore.subscribe((state) => {
                    if (
                        !applied &&
                        state?.tracks[0]?.clips.some((clip) => clip.id === 'source') &&
                        !document().tracks.tracks[0]?.clips.some((clip) => clip.id === 'source')
                    ) {
                        stagedBeforePublication = true;
                    }
                })
            );
            const sync = new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                {
                    // Matches the real non-host preparation result and retains its actual await.
                    prepareSyncPersistence: () => undefined,
                    onSyncApplied: () => {
                        applied = true;
                    },
                }
            );
            cleanups.push(() => sync.stop());
            const concurrent = mode === 'concurrent-rename' || mode === 'recreated' || mode === 'identically-recreated';
            // The receive/persistence continuation competes with the real Command
            // commit; no handler await, setter callback or microtask is fabricated.
            const inFlightUndo = concurrent ? undo() : undefined;
            if (mode !== 'none') {
                for (const syncMessageBase64 of createPeerSyncMessages({ remote: peer, local: baseline })) {
                    sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
                }
                if (!concurrent) {
                    await sync.flushPersistence();
                }
            }
            const result = await (inFlightUndo ?? undo());
            if (mode !== 'none') {
                await sync.flushPersistence();
                expect(applied).toBe(true);
            }
            expect(projectedOwners()).toEqual(owners());
            if (concurrent) {
                expect(stagedBeforePublication).toBe(true);
            }
            if (mode === 'recreated' || mode === 'identically-recreated') {
                expect(result.headConsumed).toBe(false);
                expect(owners()).toEqual([
                    ['source', mode === 'recreated' ? 'Peer source' : 'Source'],
                    ['survivor', 'Survivor'],
                ]);
            } else if (result.headConsumed) {
                expect(owners()).toEqual([
                    ['source', 'Source'],
                    ['survivor', mode === 'none' ? 'Survivor' : 'Peer survivor'],
                ]);
            } else {
                expect(mode).toBe('concurrent-rename');
                expect(owners()).toEqual([['survivor', 'Peer survivor']]);
            }
            expect(undoHistoryStore.value?.past).toHaveLength(result.headConsumed ? 0 : 1);
            expect(undoHistoryStore.value?.future).toHaveLength(result.headConsumed ? 1 : 0);
        }
    );
    it('composes a later same-target placement from the actual owning write', async () => {
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreClip') {
            throw new Error('Expected the removal inverse');
        }
        addTrack({ id: 'track-2', kind: 'audio', name: 'Destination', suppressAddedEvent: true });
        flushAutomergeStorageWrites();
        const result = await executeAppActionBatch(
            [
                entry.inverseAction,
                {
                    type: 'restoreClipPlacement',
                    payload: {
                        clipId: 'source',
                        expected: { trackId: 'track-1', startBeat: 0, endBeat: 4, automationLanes: [] },
                        replacement: { trackId: 'track-2', startBeat: 16, endBeat: 20, automationLanes: [] },
                    },
                },
            ],
            { skipUndo: true }
        );
        expect(result.status).toBe('committed');
        expect(document().tracks.tracks[1]?.clips).toMatchObject([{ id: 'source', startBeat: 16, endBeat: 20 }]);
        expect(projectedOwners()).toEqual(owners());
    });

    it('composes a later same-target split from the actual owning write', async () => {
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreClip') {
            throw new Error('Expected the removal inverse');
        }
        const source = structuredClone(sourceSnapshot);
        const emptyMidi = {
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        };
        const result = await executeAppActionBatch(
            [
                entry.inverseAction,
                {
                    type: 'restoreClipSplitState',
                    payload: {
                        clipId: 'source',
                        rightClipId: 'right',
                        expected: {
                            trackId: 'track-1',
                            leftClip: source,
                            rightClip: null,
                            rightClipIndex: 2,
                            sourceMidi: emptyMidi,
                            rightMidi: emptyMidi,
                        },
                        replacement: {
                            trackId: 'track-1',
                            leftClip: { ...source, endBeat: 2 },
                            rightClip: { ...source, id: 'right', startBeat: 2 },
                            rightClipIndex: 1,
                            sourceMidi: emptyMidi,
                            rightMidi: emptyMidi,
                        },
                        retiredTakeLanes: [],
                        reKeyedTakeLanes: [],
                    },
                },
            ],
            { skipUndo: true }
        );
        expect(result.status).toBe('committed');
        expect(document().tracks.tracks[0]?.clips).toMatchObject([
            { id: 'source', startBeat: 0, endBeat: 2 },
            { id: 'right', startBeat: 2, endBeat: 4 },
            { id: 'survivor', startBeat: 8, endBeat: 12 },
        ]);
        expect(projectedOwners()).toEqual(owners());
    });

    it('releases the owner observer if the restore throws before returning its guard', async () => {
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || !entry.inverseAction) {
            throw new Error('Expected the removal inverse');
        }
        function monitorRelease<T>(store: Pick<Store<T>, 'subscribe'>) {
            const subscribe = store.subscribe.bind(store);
            const released = vi.fn();
            vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
                const unsubscribe = subscribe(listener);
                return () => {
                    released();
                    unsubscribe();
                };
            });
            return released;
        }
        const releases = [
            monitorRelease(trackStore),
            monitorRelease(midiStore),
            monitorRelease(automationStore),
            monitorRelease(gainEnvelopeStore),
            monitorRelease(warpStateStore),
            monitorRelease(takeLaneStore),
        ];
        vi.spyOn(trackStore, 'set').mockImplementationOnce(() => {
            throw new Error('restoration write refused');
        });
        await expect(executeAppAction(entry.inverseAction, { skipUndo: true })).rejects.toThrow(
            'restoration write refused'
        );
        for (const released of releases) {
            expect(released).toHaveBeenCalledTimes(1);
        }
        expect(owners()).toEqual([['survivor', 'Survivor']]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });
    async function seedMidiProgramme() {
        addTrack({
            id: 'midi-track',
            kind: 'midi',
            name: 'MIDI',
            withoutDefaultDevice: true,
            suppressAddedEvent: true,
        });
        addClip({ id: 'source', trackId: 'midi-track', type: 'midi', name: 'MIDI source', startBeat: 0, endBeat: 4 });
        addClip({ id: 'midi-peer', trackId: 'midi-track', type: 'midi', name: 'MIDI peer', startBeat: 8, endBeat: 12 });
        const programme = {
            notesSnapshot: [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            controlChangeSnapshot: [{ id: 'source-cc', controller: 7, value: 80, beat: 0.5, channel: 1 }],
            pitchBendSnapshot: [{ id: 'source-pb', value: 512, beat: 0.75, channel: 1 }],
        };
        restoreMidiClipData({ clipId: 'source', ...programme });
        restoreMidiClipData({
            clipId: 'midi-peer',
            notesSnapshot: [{ id: 'peer-note', pitch: 64, startBeat: 0, duration: 1, velocity: 40 }],
            controlChangeSnapshot: null,
            pitchBendSnapshot: null,
        });
        flushAutomergeStorageWrites();
        const source = trackStore.value?.tracks
            .find((track) => track.id === 'midi-track')
            ?.clips.find((clip) => clip.id === 'source');
        if (!source) {
            throw new Error('Expected the full flushed MIDI source from its owner');
        }
        const sourceSnapshot = structuredClone(source);
        clearUndoHistory();
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'source', ripple: false } });
        return { ...programme, source: sourceSnapshot };
    }

    async function seedSatelliteProgramme() {
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || !entry.inverseAction) {
            throw new Error('Expected original removal');
        }
        await executeAppAction(entry.inverseAction, { skipUndo: true });
        addGainEnvelopePoint('source', 0, -6, 'source-gain');
        setWarpState('source', {
            enabled: true,
            markers: [{ id: 'source-warp', originalBeat: 0, warpedBeat: 0.25 }],
            stretchMode: 'repitch',
            originalTempo: 120,
        });
        const lane = createAutomationLane('track-1', 'gain', 'Gain', 0, 2, 'source');
        restoreAutomationLanes([
            { ...lane, id: 'source-lane', points: [{ beat: 0, value: 1, curve: 'linear', tension: 0 }] },
        ]);
        flushAutomergeStorageWrites();
        clearUndoHistory();
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'source', ripple: false } });
    }

    it('composes a later source MIDI programme from the actual owning split write', async () => {
        const programme = await seedMidiProgramme();
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreClip') {
            throw new Error('Expected the MIDI removal inverse');
        }
        const source = programme.source;
        expect(jsonValuesEqual(source, entry.inverseAction.payload.clipSnapshot)).toBe(true);
        const sourceMidi = {
            notes: { present: true, value: programme.notesSnapshot },
            controlChanges: { present: true, value: programme.controlChangeSnapshot },
            pitchBends: { present: true, value: programme.pitchBendSnapshot },
        };
        const emptyMidi = {
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        };
        const replacementMidi = {
            ...sourceMidi,
            notes: { present: true, value: programme.notesSnapshot.map((note) => ({ ...note, duration: 0.5 })) },
        };
        const result = await executeAppActionBatch(
            [
                entry.inverseAction,
                {
                    type: 'restoreClipSplitState',
                    payload: {
                        clipId: 'source',
                        rightClipId: 'right',
                        expected: {
                            trackId: 'midi-track',
                            leftClip: source,
                            rightClip: null,
                            rightClipIndex: 2,
                            sourceMidi,
                            rightMidi: emptyMidi,
                        },
                        replacement: {
                            trackId: 'midi-track',
                            leftClip: { ...source, endBeat: 2 },
                            rightClip: { ...source, id: 'right', startBeat: 2 },
                            rightClipIndex: 1,
                            sourceMidi: replacementMidi,
                            rightMidi: emptyMidi,
                        },
                        retiredTakeLanes: [],
                        reKeyedTakeLanes: [],
                    },
                },
            ],
            { skipUndo: true }
        );
        expect(result.status).toBe('committed');
        expect(document().midi.notesByClipId.source).toEqual(replacementMidi.notes.value);
        expect(document().midi.ccByClipId.source).toEqual(programme.controlChangeSnapshot);
        expect(document().midi.pitchBendByClipId.source).toEqual(programme.pitchBendSnapshot);
        expect(midiStore.value).toEqual(document().midi);
        expect(projectedOwners()).toEqual(owners());
    });

    it('commits present-empty source MIDI buckets without turning them into absent captures', async () => {
        await seedMidiProgramme();
        const entry = undoHistoryStore.value?.past[0];
        if (entry?.kind !== 'action' || !entry.inverseAction) {
            throw new Error('Expected the MIDI removal inverse');
        }
        await executeAppAction(entry.inverseAction, { skipUndo: true });
        restoreMidiClipData({
            clipId: 'source',
            notesSnapshot: [],
            controlChangeSnapshot: [],
            pitchBendSnapshot: [],
        });
        flushAutomergeStorageWrites();
        clearUndoHistory();
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'source', ripple: false } });
        const result = await undo();
        expect(result.headConsumed).toBe(true);
        expect(document().midi.notesByClipId.source).toEqual([]);
        expect(document().midi.ccByClipId.source).toEqual([]);
        expect(document().midi.pitchBendByClipId.source).toEqual([]);
        expect(midiStore.value).toEqual(document().midi);
        expect(projectedOwners()).toEqual(owners());
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
    });

    it.each(['concurrent', 'published'] as const)(
        'preserves the complete MIDI programme or refuses with a %s unrelated MIDI peer',
        async (mode) => {
            const programme = await seedMidiProgramme();
            const baseline = document();
            const rawTracks = JSON.stringify(baseline.tracks);
            const peer = change(clone(baseline, 'bbbbbbbbbbbbbbbb'), (draft) => {
                draft.midi.notesByClipId['midi-peer']![0]!.velocity = 99;
            });
            let applied = false;
            const sync = new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                {
                    prepareSyncPersistence: () => undefined,
                    onSyncApplied: () => {
                        applied = true;
                        expect(JSON.stringify(document().tracks)).toBe(rawTracks);
                    },
                }
            );
            cleanups.push(() => sync.stop());
            const pending = mode === 'concurrent' ? undo() : null;
            for (const syncMessageBase64 of createPeerSyncMessages({ remote: peer, local: baseline })) {
                sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
            }
            if (mode === 'published') {
                await sync.flushPersistence();
            }
            const result = pending ? await pending : await undo();
            await sync.flushPersistence();
            expect(applied).toBe(true);
            if (mode === 'published') {
                expect(result.headConsumed).toBe(true);
            }
            expect(document().midi.notesByClipId['midi-peer']?.[0]?.velocity).toBe(99);
            expect(midiStore.value).toEqual(document().midi);
            expect(projectedOwners()).toEqual(owners());
            if (result.headConsumed) {
                expect(document().midi.notesByClipId.source).toEqual(programme.notesSnapshot);
                expect(document().midi.ccByClipId.source).toEqual(programme.controlChangeSnapshot);
                expect(document().midi.pitchBendByClipId.source).toEqual(programme.pitchBendSnapshot);
            } else {
                expect(document().midi.notesByClipId.source).toBeUndefined();
                expect(document().midi.ccByClipId.source).toBeUndefined();
                expect(document().midi.pitchBendByClipId.source).toBeUndefined();
            }
            expect(undoHistoryStore.value?.past).toHaveLength(result.headConsumed ? 0 : 1);
            expect(undoHistoryStore.value?.future).toHaveLength(result.headConsumed ? 1 : 0);
        }
    );

    it.each(['midi', 'automation', 'gain', 'warp'] as const)(
        'refuses a late peer replacement of the restored %s owner independently of tracks',
        async (facet) => {
            if (facet === 'midi') {
                await seedMidiProgramme();
            } else {
                await seedSatelliteProgramme();
            }
            const baseline = document();
            const rawTracks = JSON.stringify(baseline.tracks);
            const peer = change(clone(baseline, 'bbbbbbbbbbbbbbbb'), (draft) => {
                if (facet === 'midi') {
                    draft.midi.notesByClipId.source = [
                        { id: 'peer-source-note', pitch: 72, startBeat: 0, duration: 1, velocity: 70 },
                    ];
                } else if (facet === 'automation') {
                    draft.automation.lanes.push({
                        id: 'source-lane',
                        trackId: 'track-1',
                        clipId: 'source',
                        parameterId: 'gain',
                        parameterName: 'Peer gain',
                        points: [{ beat: 0, value: 2, curve: 'linear', tension: 0 }],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: 0,
                        maxValue: 2,
                    });
                } else if (facet === 'gain') {
                    draft.gainEnvelopes.envelopes.source = {
                        clipId: 'source',
                        enabled: true,
                        points: [{ id: 'peer-gain', beatOffset: 0, gainDb: 3 }],
                    };
                } else {
                    draft.warpStates.states.source = {
                        enabled: true,
                        markers: [{ id: 'peer-warp', originalBeat: 0, warpedBeat: 1 }],
                        stretchMode: 'repitch',
                        originalTempo: 90,
                    };
                }
            });
            let applied = false;
            const sync = new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                {
                    prepareSyncPersistence: () => undefined,
                    onSyncApplied: () => {
                        applied = true;
                        expect(JSON.stringify(document().tracks)).toBe(rawTracks);
                    },
                }
            );
            cleanups.push(() => sync.stop());
            const pending = undo();
            for (const syncMessageBase64 of createPeerSyncMessages({ remote: peer, local: baseline })) {
                sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
            }
            const result = await pending;
            await sync.flushPersistence();
            expect(applied).toBe(true);
            expect(
                result.headConsumed,
                JSON.stringify({
                    facet,
                    midi: document().midi,
                    automation: document().automation,
                    gain: document().gainEnvelopes,
                    warp: document().warpStates,
                })
            ).toBe(false);
            expect(JSON.stringify(document().tracks)).toBe(rawTracks);
            expect(document().midi).toEqual(peer.midi);
            expect(document().automation).toEqual(peer.automation);
            expect(document().gainEnvelopes).toEqual(peer.gainEnvelopes);
            expect(document().warpStates).toEqual(peer.warpStates);
            expect(midiStore.value?.notesByClipId ?? {}).toEqual(document().midi?.notesByClipId ?? {});
            expect(midiStore.value?.ccByClipId ?? {}).toEqual(document().midi?.ccByClipId ?? {});
            expect(midiStore.value?.pitchBendByClipId ?? {}).toEqual(document().midi?.pitchBendByClipId ?? {});
            expect(automationStore.value?.lanes ?? []).toEqual(document().automation?.lanes ?? []);
            expect(gainEnvelopeStore.value?.envelopes ?? {}).toEqual(document().gainEnvelopes?.envelopes ?? {});
            expect(warpStateStore.value?.states ?? {}).toEqual(document().warpStates?.states ?? {});
            expect(projectedOwners()).toEqual(owners());
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(undoHistoryStore.value?.future).toHaveLength(0);
        }
    );
    it.each(['source-note', 'source-cc', 'source-pb'] as const)(
        'refuses a late globally occupied MIDI child %s while the source bucket remains absent',
        async (capturedId) => {
            await seedMidiProgramme();
            const baseline = document();
            const peer = change(clone(baseline, 'bbbbbbbbbbbbbbbb'), (draft) => {
                draft.midi.notesByClipId['midi-peer']!.push({
                    id: capturedId,
                    pitch: 72,
                    startBeat: 2,
                    duration: 1,
                    velocity: 70,
                });
            });
            let applied = false;
            const sync = new AutomergeSync(
                { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
                {
                    prepareSyncPersistence: () => undefined,
                    onSyncApplied: () => {
                        applied = true;
                        expect(document().midi.notesByClipId.source).toBeUndefined();
                    },
                }
            );
            cleanups.push(() => sync.stop());
            const pending = undo();
            for (const syncMessageBase64 of createPeerSyncMessages({ remote: peer, local: baseline })) {
                sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
            }
            const result = await pending;
            await sync.flushPersistence();
            expect(applied).toBe(true);
            expect(result.headConsumed).toBe(false);
            expect(document().midi.notesByClipId.source).toBeUndefined();
            expect(document().midi.notesByClipId['midi-peer']?.some((note) => note.id === capturedId)).toBe(true);
            expect(midiStore.value).toEqual(document().midi);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(undoHistoryStore.value?.future).toHaveLength(0);
        }
    );

    it('refuses a late restored automation-lane ID occupied by an unrelated clip', async () => {
        await seedSatelliteProgramme();
        const baseline = document();
        const lane = createAutomationLane('track-1', 'gain', 'Peer gain', 0, 2, 'survivor');
        const peerLane = { ...lane, id: 'source-lane' };
        const peer = change(clone(baseline, 'bbbbbbbbbbbbbbbb'), (draft) => {
            draft.automation.lanes.push(peerLane);
        });
        let applied = false;
        const sync = new AutomergeSync(
            { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
            {
                prepareSyncPersistence: () => undefined,
                onSyncApplied: () => {
                    applied = true;
                    expect(document().automation.lanes.some((lane) => lane.clipId === 'source')).toBe(false);
                },
            }
        );
        cleanups.push(() => sync.stop());
        const pending = undo();
        for (const syncMessageBase64 of createPeerSyncMessages({ remote: peer, local: baseline })) {
            sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
        }
        const result = await pending;
        await sync.flushPersistence();
        expect(applied).toBe(true);
        expect(result.headConsumed).toBe(false);
        expect(document().automation.lanes).toEqual([peerLane]);
        expect(automationStore.value).toEqual(document().automation);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(0);
    });

    it('preserves the clip-local gain-point namespace during a concurrent MIDI restoration', async () => {
        const programme = await seedMidiProgramme();
        addGainEnvelopePoint('midi-peer', 0, 0, 'peer-gain-setup');
        flushAutomergeStorageWrites();
        const baseline = document();
        const peer = change(clone(baseline, 'bbbbbbbbbbbbbbbb'), (draft) => {
            draft.gainEnvelopes.envelopes['midi-peer']!.points.push({ id: 'source-note', beatOffset: 1, gainDb: -3 });
        });
        let applied = false;
        const sync = new AutomergeSync(
            { getConnectedPeerIds: () => [], sendCrdtSync: () => undefined },
            {
                prepareSyncPersistence: () => undefined,
                onSyncApplied: () => {
                    applied = true;
                },
            }
        );
        cleanups.push(() => sync.stop());
        const pending = undo();
        for (const syncMessageBase64 of createPeerSyncMessages({ remote: peer, local: baseline })) {
            sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
        }
        const result = await pending;
        await sync.flushPersistence();
        expect(applied).toBe(true);
        expect(result.headConsumed).toBe(true);
        expect(document().midi.notesByClipId.source).toEqual(programme.notesSnapshot);
        expect(
            document().gainEnvelopes.envelopes['midi-peer']?.points.some((point) => point.id === 'source-note')
        ).toBe(true);
        expect(midiStore.value).toEqual(document().midi);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
    });
});
