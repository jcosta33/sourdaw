import { change, clone, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
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

import { AutomergeSync } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = {
    tracks: { tracks: Array<{ id: string; clips: Array<{ id: string; name: string }> }> };
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
        const subscribe = trackStore.subscribe.bind(trackStore);
        const released = vi.fn();
        vi.spyOn(trackStore, 'subscribe').mockImplementation((listener) => {
            const unsubscribe = subscribe(listener);
            return () => {
                released();
                unsubscribe();
            };
        });
        vi.spyOn(trackStore, 'set').mockImplementationOnce(() => {
            throw new Error('restoration write refused');
        });
        await expect(executeAppAction(entry.inverseAction, { skipUndo: true })).rejects.toThrow(
            'restoration write refused'
        );
        expect(released).toHaveBeenCalledTimes(1);
        expect(owners()).toEqual([['survivor', 'Survivor']]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });
});
