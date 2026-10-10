import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../resolveComping';
import { prepareClipSplit } from '../prepareClipSplit';
import { restoreClipSplitState } from '../restoreClipSplitState';
import { splitClipWithUndo } from '../splitClipWithUndo';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function hydrateProductionHandlers(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function rightClipId(): string {
    const clip = trackStore.value?.tracks[0]?.clips.find((candidate) => candidate.id !== 'clip-1');
    if (!clip) {
        throw new Error('expected the split to create a right clip');
    }
    return clip.id;
}

function seedCompedAudio(): void {
    const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', type: 'audio', startBeat: 0, endBeat: 8 });
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
                id: 'lane-1',
                takes: [
                    { ...createTake('clip-1', 'Selected', 0, 8), id: 'take-1', selected: true, sourceOffsetSeconds: 1 },
                    {
                        ...createTake('clip-1', 'Inactive', 1, 7),
                        id: 'inactive',
                        selected: false,
                        sourceOffsetSeconds: 0,
                    },
                ],
                activeCompRegions: [{ takeId: 'take-1', startBeat: 0, endBeat: 8 }],
            },
        ],
    });
}

describe('splitClipWithUndo take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split clip take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 8 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores a take recorded on the right half when the split is redone', async () => {
        splitClipWithUndo('clip-1', 4);
        const splitRightClipId = rightClipId();

        // A take lands on the right half without a local undo entry.
        const take = createTake(splitRightClipId, 'Right take', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();

        // The right half's id is generated, so its order against the source's is not
        // a contract: compare both sides sorted rather than pinning one order.
        expect([...(trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)].sort()).toEqual(
            [splitRightClipId, 'clip-1'].sort()
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });

    it('retires a right-half take on split undo and reinstates it on redo, through the command handler (#4521)', async () => {
        // Split through the command path so the restoreClipSplitState payloads are
        // the real producer shape — rightClip null on the undo's replacement.
        await executeAppAction({ type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } }, { source: 'manual' });
        const splitRightClipId = rightClipId();

        // A take lands on the right half after the split — no local undo entry
        // names it, so only the undo's capture can carry it to the redo.
        const take = createTake(splitRightClipId, 'Right take', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect((trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)).toEqual(['clip-1']);
        // The undo filtered the right clip out; its take lanes retire with it.
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();
        expect([...(trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)].sort()).toEqual(
            [splitRightClipId, 'clip-1'].sort()
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });

    it('replays a saved trim then split group while retaining later peer take ownership', async () => {
        hydrateProductionHandlers();
        const original = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            type: 'audio',
            startBeat: 2,
            endBeat: 8,
            audioOffsetBeats: 2,
        });
        delete original.audioOffsetSeconds;
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [original] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        const result = await executeAppActionBatch(
            [
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 3 } },
                { type: 'splitClip', payload: { clipId: 'clip-1', beat: 5, rightClipId: 'right' } },
            ],
            { source: 'manual', groupId: 'trim-split-prefix' }
        );
        expect(result.status, JSON.stringify(result)).toBe('committed');
        expect(
            trackStore.value?.tracks[0]?.clips.map(({ id, startBeat, endBeat, audioOffsetSeconds }) => ({
                id,
                startBeat,
                endBeat,
                audioOffsetSeconds,
            }))
        ).toEqual([
            { id: 'clip-1', startBeat: 3, endBeat: 5, audioOffsetSeconds: 1.5 },
            { id: 'right', startBeat: 5, endBeat: 8, audioOffsetSeconds: 2.5 },
        ]);
        const after = structuredClone(trackStore.value);
        const later = { ...createTake('right', 'Peer later right', 5, 8), id: 'later-right', selected: true };
        const left = { ...createTake('clip-1', 'Peer left name', 3, 5), id: 'peer-left', selected: false };
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            id: 'peer-lane',
            takes: [left, later],
            activeCompRegions: [],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();
        const assertRaw = () => {
            const raw = getCrdtDoc<{
                tracks: NonNullable<typeof trackStore.value>;
                takeLanes: NonNullable<typeof takeLaneStore.value>;
            }>('root');
            expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
            expect(raw?.takeLanes).toEqual(takeLaneStore.value);
        };
        assertRaw();
        const selectedLeft = { ...left, name: 'Peer selected survivor', selected: true };
        for (const cycle of [1, 2]) {
            expect((await undo()).headConsumed, `Undo cycle ${cycle}`).toBe(true);
            expect(trackStore.value?.tracks[0]?.clips).toEqual([original]);
            expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([cycle === 1 ? left : selectedLeft]);
            expect(undoHistoryStore.value?.future).toHaveLength(2);
            assertRaw();
            mutateCrdtDoc<{ takeLanes: NonNullable<typeof takeLaneStore.value> }>({
                id: 'root',
                changeFn: (project) => {
                    const survivor = project.takeLanes.lanes[0]?.takes.find((take) => take.id === left.id);
                    if (!survivor) {
                        throw new Error('Expected surviving peer take');
                    }
                    survivor.name = selectedLeft.name;
                    survivor.selected = true;
                },
            });
            projectCrdtToStores();
            await vi.waitFor(() => {
                const saved: unknown = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}');
                expect(saved).toMatchObject({ future: [expect.anything(), expect.anything()] });
            });
            const current = getCrdtDoc('root');
            if (!current) {
                throw new Error('Expected committed project for saved group replay');
            }
            replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load(Automerge.save(current)) });
            projectCrdtToStores({ resetProjections: true });
            hydrateProductionHandlers();
            expect(undoHistoryStore.value?.future).toHaveLength(2);
            await redo();
            expect(trackStore.value?.tracks[0]?.clips).toEqual(after?.tracks[0]?.clips);
            expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([selectedLeft, { ...later, selected: false }]);
            expect(undoHistoryStore.value?.past).toHaveLength(2);
            expect(undoHistoryStore.value?.future).toHaveLength(0);
            assertRaw();
        }
    });

    it.each([0, -1, 2])('replays the admitted slip then split source prefix at %s seconds', async (seconds) => {
        const action: AppAction = {
            type: 'slipClipContent',
            payload: { clipId: 'clip-1', clipType: 'audio', offset: 4, offsetSeconds: seconds },
        };
        const original = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            type: 'audio',
            startBeat: 2,
            endBeat: 8,
            audioOffsetBeats: 2,
        });
        delete original.audioOffsetSeconds;
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [original] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        const result = await executeAppActionBatch(
            [action, { type: 'splitClip', payload: { clipId: 'clip-1', beat: 5, rightClipId: 'right' } }],
            { source: 'manual', groupId: 'geometry-split-prefix' }
        );
        expect(result.status, JSON.stringify(result)).toBe('committed');
        const after = structuredClone(trackStore.value?.tracks[0]?.clips);
        expect(after).toHaveLength(2);
        expect(after?.map((clip) => clip.audioOffsetSeconds)).toEqual([seconds, seconds + 1.5]);
        expect((await undo()).headConsumed).toBe(true);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([original]);
        await redo();
        expect(trackStore.value?.tracks[0]?.clips).toEqual(after);
        expect(getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root')?.tracks.tracks[0]?.clips).toEqual(
            after
        );
        expect(undoHistoryStore.value?.future).toHaveLength(0);
    });

    it.each<AppAction>([
        { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 7 } },
        { type: 'nudgeClip', payload: { clipId: 'clip-1', beats: 1 } },
        { type: 'moveClip', payload: { clipId: 'clip-1', trackId: 'track-1', startBeat: 3 } },
    ])('retains singleton admission for $type before split', async (action) => {
        flushAutomergeStorageWrites();
        const raw = structuredClone(getCrdtDoc('root'));
        const owners = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
        const history = undoHistoryStore.value;
        const result = await executeAppActionBatch(
            [action, { type: 'splitClip', payload: { clipId: 'clip-1', beat: 5, rightClipId: 'right' } }],
            { source: 'manual', groupId: 'singleton-prefix' }
        );
        expect(result).toEqual({
            status: 'rejected',
            reason: `Action must execute as a singleton batch: ${action.type}`,
            actions: [],
        });
        expect(getCrdtDoc('root')).toEqual(raw);
        expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(owners);
        expect(undoHistoryStore.value).toBe(history);
    });

    it('refuses the saved trim then split group atomically when a later right take ID is reused', async () => {
        hydrateProductionHandlers();
        const original = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            type: 'audio',
            startBeat: 2,
            endBeat: 8,
            audioOffsetBeats: 2,
        });
        delete original.audioOffsetSeconds;
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [original] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        const result = await executeAppActionBatch(
            [
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 3 } },
                { type: 'splitClip', payload: { clipId: 'clip-1', beat: 5, rightClipId: 'right' } },
            ],
            { source: 'manual', groupId: 'trim-split-take-conflict' }
        );
        expect(result.status).toBe('committed');
        const later = { ...createTake('right', 'Later right', 5, 8), id: 'later-right' };
        const lane: TakeLane = { ...createTakeLane('track-1'), id: 'later-lane', takes: [later] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();
        expect((await undo()).headConsumed).toBe(true);
        await vi.waitFor(() => {
            const saved: unknown = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}');
            expect(saved).toMatchObject({ future: [expect.anything(), expect.anything()] });
        });
        hydrateProductionHandlers();
        takeLaneStore.set({
            lanes: [{ ...lane, takes: [{ ...later, clipId: 'peer-clip', sourceOffsetSeconds: 20 }] }],
        });
        flushAutomergeStorageWrites();
        const raw = structuredClone(getCrdtDoc('root'));
        const projected = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
        const history = undoHistoryStore.value;
        const writes = [vi.spyOn(trackStore, 'set'), vi.spyOn(takeLaneStore, 'set'), vi.spyOn(undoHistoryStore, 'set')];
        try {
            await redo();
            expect(getCrdtDoc('root')).toEqual(raw);
            expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(projected);
            expect(undoHistoryStore.value).toBe(history);
            for (const write of writes) {
                expect(write).not.toHaveBeenCalled();
            }
        } finally {
            for (const write of writes) {
                write.mockRestore();
            }
        }
    });

    it('partitions inactive takes and preserves live names, selection and unrelated comp material across replay', async () => {
        seedCompedAudio();
        const projectedMedia = () =>
            resolveClipsWithComping('track-1', trackStore.value!.tracks[0]!.clips).map(
                ({ startBeat, endBeat, audioOffsetSeconds }) => ({ startBeat, endBeat, audioOffsetSeconds })
            );
        const beforeMedia = projectedMedia();
        expect(beforeMedia).toEqual([{ startBeat: 0, endBeat: 8, audioOffsetSeconds: 1 }]);
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4, rightClipId: 'right' } },
            { source: 'manual' }
        );
        const splitLane = takeLaneStore.value!.lanes[0]!;
        expect(
            splitLane.takes.map(({ id, clipId, startBeat, endBeat, selected }) => ({
                id,
                clipId,
                startBeat,
                endBeat,
                selected,
            }))
        ).toEqual([
            { id: 'take-1', clipId: 'clip-1', startBeat: 0, endBeat: 4, selected: true },
            { id: 'take-1:split-right:right', clipId: 'right', startBeat: 4, endBeat: 8, selected: false },
            { id: 'inactive', clipId: 'clip-1', startBeat: 1, endBeat: 4, selected: false },
            { id: 'inactive:split-right:right', clipId: 'right', startBeat: 4, endBeat: 7, selected: false },
        ]);
        expect(splitLane.takes.filter((take) => take.selected).map((take) => take.id)).toEqual(['take-1']);
        expect(splitLane.activeCompRegions).toEqual([
            { takeId: 'take-1', startBeat: 0, endBeat: 4 },
            { takeId: 'take-1:split-right:right', startBeat: 4, endBeat: 8 },
        ]);
        const splitMedia = projectedMedia();
        expect(splitMedia).toEqual([
            { startBeat: 0, endBeat: 4, audioOffsetSeconds: 1 },
            { startBeat: 4, endBeat: 8, audioOffsetSeconds: 3 },
        ]);
        const unrelated = { ...createTake('peer-clip', 'Peer', 10, 12), id: 'peer-take' };
        const peerRegion = { takeId: unrelated.id, startBeat: 10, endBeat: 12 };
        takeLaneStore.set({
            lanes: [
                {
                    ...splitLane,
                    automationLaneId: 'peer-automation',
                    takes: [
                        ...splitLane.takes.map((take) => ({ ...take, name: `Peer ${take.id}`, selected: false })),
                        unrelated,
                    ],
                    activeCompRegions: [...splitLane.activeCompRegions, peerRegion],
                },
            ],
        });
        const splitTakes = structuredClone(takeLaneStore.value!.lanes[0]!.takes);

        await undo();
        expect(takeLaneStore.value!.lanes[0]).toMatchObject({ automationLaneId: 'peer-automation' });
        expect(takeLaneStore.value!.lanes[0]!.takes).toEqual([
            expect.objectContaining({ id: 'take-1', endBeat: 8, name: 'Peer take-1', selected: false }),
            expect.objectContaining({ id: 'inactive', endBeat: 7, name: 'Peer inactive', selected: false }),
            unrelated,
        ]);
        expect(takeLaneStore.value!.lanes[0]!.activeCompRegions).toEqual([
            { takeId: 'take-1', startBeat: 0, endBeat: 8 },
            peerRegion,
        ]);
        expect(projectedMedia()).toEqual(beforeMedia);
        expect(takeLaneStore.value!.lanes[0]!.takes.filter((take) => take.selected)).toEqual([]);
        await redo();
        expect(takeLaneStore.value!.lanes[0]!.takes).toEqual(splitTakes);
        expect(takeLaneStore.value!.lanes[0]!.activeCompRegions).toEqual([...splitLane.activeCompRegions, peerRegion]);
        expect(projectedMedia()).toEqual(splitMedia);
        expect(takeLaneStore.value!.lanes[0]!.takes.filter((take) => take.selected)).toEqual([]);
    });

    it.each(['depth', 'geometry', 'comp'] as const)(
        'refuses a split undo before any write after peer %s changes',
        async (change) => {
            seedCompedAudio();
            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4, rightClipId: 'right' } },
                { source: 'manual' }
            );
            const lane = takeLaneStore.value!.lanes[0]!;
            const peerLane: TakeLane = {
                ...lane,
                takes: lane.takes.map((take) => {
                    if (take.id !== 'take-1') {
                        return take;
                    }
                    if (change === 'depth') {
                        return { ...take, sourceOffsetSeconds: 2 };
                    }
                    if (change === 'geometry') {
                        return { ...take, startBeat: 1 };
                    }
                    return take;
                }),
            };
            if (change === 'comp') {
                peerLane.activeCompRegions = lane.activeCompRegions.map((region, index) =>
                    index === 0 ? { ...region, startBeat: 1 } : region
                );
            }
            takeLaneStore.set({
                lanes: [peerLane],
            });
            const before = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
            await undo();
            expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(before);
            expect(undoHistoryStore.value!.past).toHaveLength(1);
            expect(undoHistoryStore.value!.future).toEqual([]);
        }
    );

    it('rejects an unpaired take capture before geometry or take writes', () => {
        seedCompedAudio();
        const plan = prepareClipSplit({ clipId: 'clip-1', splitBeat: 4, rightClipId: 'right' });
        expect(plan).not.toBeNull();
        if (!plan) {
            throw new Error('expected split plan');
        }
        const { takeLanes: ignored, ...unpaired } = plan.next;
        expect(ignored).toBeDefined();
        const before = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
        expect(
            restoreClipSplitState({
                clipId: 'clip-1',
                rightClipId: 'right',
                expected: plan.previous,
                replacement: unpaired,
            })
        ).toBe(false);
        expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(before);
    });

    it.each(['typed', 'callback'] as const)(
        'replays stacked %s splits with stable take and clip IDs',
        async (route) => {
            seedCompedAudio();
            const before = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
            if (route === 'typed') {
                await executeAppAction(
                    { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } },
                    { source: 'manual' }
                );
            } else {
                splitClipWithUndo('clip-1', 4);
            }
            const right = rightClipId();
            if (route === 'typed') {
                await executeAppAction(
                    { type: 'splitClip', payload: { clipId: right, beat: 6 } },
                    { source: 'manual' }
                );
            } else {
                splitClipWithUndo(right, 6);
            }
            const after = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
            expect(trackStore.value!.tracks[0]!.clips.map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
                [0, 4],
                [4, 6],
                [6, 8],
            ]);
            await undo();
            await undo();
            expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(before);
            await redo();
            await redo();
            expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(after);
        }
    );

    it.each(['typed', 'callback'] as const)(
        'refuses %s redo before writes when a later right take ID collides with peer media',
        async (route) => {
            seedCompedAudio();
            if (route === 'typed') {
                await executeAppAction(
                    { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } },
                    { source: 'manual' }
                );
            } else {
                splitClipWithUndo('clip-1', 4);
            }
            const right = rightClipId();
            const lane = takeLaneStore.value!.lanes[0]!;
            const later = { ...createTake(right, 'Later', 4, 8), id: 'later-right' };
            takeLaneStore.set({ lanes: [{ ...lane, takes: [...lane.takes, later] }] });
            await undo();
            const unsplit = takeLaneStore.value!.lanes[0]!;
            takeLaneStore.set({
                lanes: [
                    {
                        ...unsplit,
                        takes: [...unsplit.takes, { ...later, clipId: 'peer-clip', sourceOffsetSeconds: 20 }],
                    },
                ],
            });
            const before = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
            await redo();
            expect({ tracks: trackStore.value, takes: takeLaneStore.value }).toEqual(before);
            expect(undoHistoryStore.value!.past).toEqual([]);
            expect(undoHistoryStore.value!.future).toHaveLength(route === 'typed' ? 1 : 0);
        }
    );
});
