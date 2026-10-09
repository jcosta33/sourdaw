import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

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
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 8 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
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
