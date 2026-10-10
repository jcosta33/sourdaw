import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

const mocks = vi.hoisted(() => {
    const trackState = { value: null as unknown };
    const markerState = { value: null as unknown };
    return {
        trackState,
        markerState,
        batchDepth: 0,
    };
});

vi.mock('#/infra/store/createStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/store/createStore')>();
    return {
        ...actual,
        batchStoreUpdates<TResult>(update: () => TResult): TResult {
            mocks.batchDepth++;
            try {
                return update();
            } finally {
                mocks.batchDepth--;
            }
        },
    };
});

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: () => mocks.trackState.value,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: (state: unknown) => {
        mocks.trackState.value = state;
    },
}));

// The comping restore guards read the store-facing accessor rather than the
// repository: point it at the same state so the undo path sees the clips the
// restore just brought back.
vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: () => mocks.trackState.value,
}));

vi.mock('../../../stores/markerStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/markerStore')>();
    return {
        ...actual,
        markerStore: {
            get value() {
                return mocks.markerState.value;
            },
            set(state: unknown) {
                mocks.markerState.value = state;
            },
        },
    };
});

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type Take, type TakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { type Clip } from '../../../stores/trackStore';
import { resolveClipsWithComping } from '../../resolveComping';
import { createUndoableGlobalTimeOperation } from '../createUndoableGlobalTimeOperation';
import { executeGlobalTimeOperation } from '../executeGlobalTimeOperation';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

function createClip(input: { id: string; startBeat: number; endBeat: number }): Clip {
    return {
        id: input.id,
        trackId: 'track-1',
        name: input.id,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function setTracks(clips: Clip[]): void {
    mocks.trackState.value = {
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips })],
        selectedTrackId: 'track-1',
    };
    mocks.markerState.value = { markers: [], sections: [] };
}

/** Every owner idles: the take-lane leg under test owns no dependency. */
function registerIdleDependencies(): void {
    const idle = {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: () => true,
        revert: () => true,
    };
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: () => idle,
        prepareAutomationTimeStateRestore: () => idle,
        prepareTimelineMapTimeOperation: () => idle,
        prepareTimelineMapStateRestore: () => idle,
        prepareMidiGlobalTimeTransaction: () => idle,
        prepareMidiTimeStateRestore: () => idle,
    });
}

/**
 * The #4841 arrangement: one clip the deleted span cuts or moves, comped by a
 * take with an active region spanning the whole clip.
 */
function setCompedClip(input: { clipId: string; startBeat: number; endBeat: number }): { take: Take; lane: TakeLane } {
    setTracks([createClip({ id: input.clipId, startBeat: input.startBeat, endBeat: input.endBeat })]);
    const take = createTake(input.clipId, 'The take', input.startBeat, input.endBeat);
    const lane: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [take],
        activeCompRegions: [{ startBeat: input.startBeat, endBeat: input.endBeat, takeId: take.id }],
    };
    takeLaneStore.set({ lanes: [lane] });
    return { take, lane };
}

function liveTrackClips(): readonly Clip[] {
    const state = mocks.trackState.value as { tracks: Array<{ clips: Clip[] }> };
    return state.tracks[0]?.clips ?? [];
}

function liveLane(): TakeLane {
    const lane = takeLaneStore.value?.lanes[0];
    if (!lane) {
        throw new Error('Expected the take lane to survive');
    }
    return lane;
}

function requireApplied(result: ReturnType<typeof executeGlobalTimeOperation>) {
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') {
        throw new Error('Expected an applied global time operation');
    }
    return result;
}

describe('delete time re-keys take-lane state (#4841)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.batchDepth = 0;
        setTimeOperationDependencies(null);
        setTracks([]);
        takeLaneStore.set({ lanes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        tempoMapStore.set({ changes: [] });
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    it.each([
        { operation: { type: 'insert' as const, atBeat: 1, durationBeats: 4 }, expectedBeat: 6 },
        { operation: { type: 'duplicate' as const, startBeat: 2, endBeat: 4 }, expectedBeat: 4 },
    ])(
        '$operation.type keeps comped take source depth when placing material after a tempo seam',
        ({ operation, expectedBeat }) => {
            tempoMapStore.set({
                changes: [
                    { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
                ],
            });
            const { take } = setCompedClip({ clipId: 'source', startBeat: 2, endBeat: 4 });
            takeLaneStore.set({ lanes: [{ ...liveLane(), takes: [{ ...take, sourceOffsetBeats: 2 }] }] });
            registerIdleDependencies();

            const applied = requireApplied(executeGlobalTimeOperation({ operation }));
            const target = liveTrackClips().find((clip) => clip.startBeat === expectedBeat);
            expect(target).toBeDefined();
            const targetTake = liveLane().takes.find((candidate) => candidate.clipId === target?.id);
            expect(targetTake).toMatchObject({ startBeat: expectedBeat, sourceOffsetSeconds: 1 });
            expect(liveLane().activeCompRegions).toContainEqual({
                startBeat: expectedBeat,
                endBeat: expectedBeat + 2,
                takeId: targetTake?.id,
            });
            expect(
                resolveClipsWithComping('track-1', [...liveTrackClips()]).find(
                    (clip) => clip.startBeat === expectedBeat
                )?.audioOffsetSeconds
            ).toBe(1);

            const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
            transaction.undo();
            expect(liveLane().takes[0]).toHaveProperty('sourceOffsetBeats', 2);
            expect(liveLane().takes[0]).not.toHaveProperty('sourceOffsetSeconds');
            transaction.redo();
            expect(liveLane().takes.find((candidate) => candidate.clipId === target?.id)?.sourceOffsetSeconds).toBe(1);
        }
    );

    it('partitions later-right takes and comp regions at an audio insert seam without losing canonical zero', () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const { take } = setCompedClip({ clipId: 'source', startBeat: 2, endBeat: 8 });
        const left = { ...take, endBeat: 4, sourceOffsetBeats: 2 };
        const right = {
            ...createTake('source', 'Later take', 4, 8),
            sourceOffsetSeconds: 0,
            sourceOffsetBeats: 99,
        };
        const beforeLane: TakeLane = {
            ...liveLane(),
            takes: [left, right],
            activeCompRegions: [
                { startBeat: 2, endBeat: 4, takeId: left.id },
                { startBeat: 4, endBeat: 8, takeId: right.id },
            ],
        };
        takeLaneStore.set({ lanes: [beforeLane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 4, durationBeats: 2 } })
        );
        const rightClip = liveTrackClips().find((clip) => clip.id !== 'source');
        const rightTake = liveLane().takes.find((candidate) => candidate.clipId === rightClip?.id);
        expect(rightTake).toMatchObject({ startBeat: 6, endBeat: 10, sourceOffsetSeconds: 0, sourceOffsetBeats: 99 });
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 2, endBeat: 4, takeId: left.id },
            { startBeat: 6, endBeat: 10, takeId: rightTake?.id },
        ]);
        expect(
            resolveClipsWithComping('track-1', [...liveTrackClips()]).find((clip) => clip.startBeat === 6)
                ?.audioOffsetSeconds
        ).toBe(1);
        const afterLane = structuredClone(liveLane());
        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
        transaction.undo();
        expect(liveLane()).toEqual(beforeLane);
        transaction.redo();
        expect(liveLane()).toEqual(afterLane);
    });

    it('keeps canonical zero ahead of a stale take beat alias on the duplicated comp', () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const { take } = setCompedClip({ clipId: 'source', startBeat: 2, endBeat: 4 });
        takeLaneStore.set({
            lanes: [
                {
                    ...liveLane(),
                    takes: [{ ...take, sourceOffsetSeconds: 0, sourceOffsetBeats: 9 }],
                },
            ],
        });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'duplicate', startBeat: 2, endBeat: 4 } })
        );
        const copiedClip = liveTrackClips().find((clip) => clip.id !== 'source');
        const copiedTake = liveLane().takes.find((candidate) => candidate.clipId === copiedClip?.id);
        expect(copiedTake).toMatchObject({ sourceOffsetSeconds: 0, sourceOffsetBeats: 9 });
        expect(
            resolveClipsWithComping('track-1', [...liveTrackClips()]).find((clip) => clip.id === copiedClip?.id)
                ?.audioOffsetSeconds
        ).toBe(0);

        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
        transaction.undo();
        expect(liveLane().takes).toEqual([{ ...take, sourceOffsetSeconds: 0, sourceOffsetBeats: 9 }]);
        transaction.redo();
        expect(liveLane().takes.find((candidate) => candidate.clipId === copiedClip?.id)).toEqual(copiedTake);
    });

    it('materializes a legacy take at its original slow clip start before delete time moves it to the fast side', () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const { take } = setCompedClip({ clipId: 'keeper', startBeat: 6, endBeat: 10 });
        takeLaneStore.set({ lanes: [{ ...liveLane(), takes: [{ ...take, sourceOffsetBeats: 2 }] }] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );
        expect(liveLane().takes[0]).toMatchObject({ startBeat: 2, endBeat: 6, sourceOffsetSeconds: 2 });
        expect(resolveClipsWithComping('track-1', [...liveTrackClips()])[0]?.audioOffsetSeconds).toBe(2);
        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
        transaction.undo();
        expect(liveLane().takes[0]).toHaveProperty('sourceOffsetBeats', 2);
        expect(liveLane().takes[0]).not.toHaveProperty('sourceOffsetSeconds');
        transaction.redo();
        expect(liveLane().takes[0]?.sourceOffsetSeconds).toBe(2);
    });

    it('re-keys the take and comp region of a clip that starts inside the deleted span and outlives it', () => {
        const { take } = setCompedClip({ clipId: 'tail', startBeat: 4, endBeat: 10 });
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        // The clip survives under a fresh id at [2,6] — the ripple pulls the
        // material right of the span left by the deleted duration.
        const clips = liveTrackClips();
        expect(clips).toHaveLength(1);
        const fragment = clips[0]!;
        expect(fragment.id).not.toBe('tail');
        expect([fragment.startBeat, fragment.endBeat]).toEqual([2, 6]);
        // The take follows the material it still covers: re-keyed onto the
        // fragment, its deleted head [4,6] gone, the rest shifted with it.
        expect(liveLane().takes).toEqual([{ ...take, clipId: fragment.id, startBeat: 2, endBeat: 6 }]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: take.id }]);
        // Before the fix the take stayed keyed to the deleted id at [4,10] and
        // its region kept advancing the comp cursor: the fragment resolved
        // only [2,4] and played silence over [4,6].
        expect(resolveClipsWithComping('track-1', [fragment]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [2, 6],
        ]);
    });

    it('splits the take and comp region of a clip spanning the deleted span', () => {
        const { take } = setCompedClip({ clipId: 'span', startBeat: 0, endBeat: 10 });
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        // The left half keeps the clip id; the right half lands at [2,6] under
        // a fresh one.
        const clips = liveTrackClips();
        expect(clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['span', 0, 2],
            [expect.any(String), 2, 6],
        ]);
        const right = clips[1]!;
        expect(right.id).not.toBe('span');
        // One take per fragment: the left keeps the take's id — the split
        // convention — and the right mints a deterministic one, so a replayed
        // redo re-mints the same id.
        const rightTakeId = `${take.id}:time-delete-right:2:6`;
        expect(liveLane().takes).toEqual([
            { ...take, startBeat: 0, endBeat: 2 },
            { ...take, id: rightTakeId, clipId: right.id, startBeat: 2, endBeat: 6 },
        ]);
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: take.id },
            { startBeat: 2, endBeat: 6, takeId: rightTakeId },
        ]);
        // Before the fix the right fragment had no take at all and the stale
        // region still comped its span: it resolved to nothing.
        expect(resolveClipsWithComping('track-1', [...clips]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [2, 6],
        ]);
    });

    it('shifts the take and region of a clip the ripple moves left, keeping their ids', () => {
        const { take } = setCompedClip({ clipId: 'keeper', startBeat: 6, endBeat: 10 });
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        const keeper = liveTrackClips()[0]!;
        expect(keeper.id).toBe('keeper');
        expect([keeper.startBeat, keeper.endBeat]).toEqual([2, 6]);
        expect(liveLane().takes).toEqual([{ ...take, startBeat: 2, endBeat: 6 }]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: take.id }]);
    });

    it('restores the original takes and regions on undo and re-keys them again on redo', () => {
        const { take, lane } = setCompedClip({ clipId: 'span', startBeat: 0, endBeat: 10 });
        registerIdleDependencies();

        const initialResult = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        const applied = requireApplied(initialResult);
        // The capture rides the inverse plan as plain JSON, like every other slot.
        const serializedPlan = JSON.stringify(applied.inversePlan);
        expect(JSON.parse(serializedPlan)).toEqual(applied.inversePlan);
        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });

        const rightTakeId = `${take.id}:time-delete-right:2:6`;
        expect(liveLane().takes.map((candidate) => candidate.id)).toEqual([take.id, rightTakeId]);

        transaction.undo();

        expect(liveTrackClips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['span', 0, 10]]);
        const restoredLane = liveLane();
        expect(restoredLane.id).toBe(lane.id);
        expect(restoredLane.takes).toEqual([take]);
        expect(restoredLane.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 10, takeId: take.id }]);

        transaction.redo();

        const clips = liveTrackClips();
        expect(clips.map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [2, 6],
        ]);
        // The replayed re-key reproduces the exact forward facets, minted ids
        // included — they ride the plan, so redo cannot drift.
        expect(liveLane().takes.map((candidate) => candidate.id)).toEqual([take.id, rightTakeId]);
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: take.id },
            { startBeat: 2, endBeat: 6, takeId: rightTakeId },
        ]);
        expect(resolveClipsWithComping('track-1', [...clips]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [2, 6],
        ]);
    });

    it('carries the re-keyed lane in the inverse plan, alongside an empty retirement', () => {
        const { take, lane } = setCompedClip({ clipId: 'tail', startBeat: 4, endBeat: 10 });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        const fragment = liveTrackClips()[0]!;
        expect(applied.inversePlan).toMatchObject({
            takeLanes: {
                version: 1,
                appliedEffect: 'restore',
                removedClipIds: [],
                retiredLanes: [],
                reKeyedLanes: [
                    {
                        laneId: lane.id,
                        trackId: 'track-1',
                        takesBefore: [take],
                        takesAfter: [{ ...take, clipId: fragment.id, startBeat: 2, endBeat: 6 }],
                        regionsBefore: [{ startBeat: 4, endBeat: 10, takeId: take.id }],
                        regionsAfter: [{ startBeat: 2, endBeat: 6, takeId: take.id }],
                    },
                ],
            },
        });
    });

    it('records no take-lane slot when a delete touches no take', () => {
        setTracks([createClip({ id: 'lonely', startBeat: 4, endBeat: 10 })]);
        takeLaneStore.set({ lanes: [] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        expect(applied.inversePlan).toMatchObject({ takeLanes: null });
    });

    it('keeps the survivor comp region of a clip moved onto a retired region’s span, and restores both on undo', () => {
        // The doomed clip comps [2,6]; the keeper comps [6,10]. Deleting [2,6]
        // retires the doomed clip and ripples the keeper onto the freed span —
        // where the keeper's remapped region must not lose to the retired one.
        setTracks([
            createClip({ id: 'comped', startBeat: 2, endBeat: 6 }),
            createClip({ id: 'keeper', startBeat: 6, endBeat: 10 }),
        ]);
        const compedTake = createTake('comped', 'Doomed', 2, 6);
        const keeperTake = createTake('keeper', 'Survivor', 6, 10);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [compedTake, keeperTake],
            activeCompRegions: [
                { startBeat: 2, endBeat: 6, takeId: compedTake.id },
                { startBeat: 6, endBeat: 10, takeId: keeperTake.id },
            ],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        expect(liveTrackClips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['keeper', 2, 6]]);
        // The retired clip's take and region are gone; the survivor's region
        // moved with its clip onto the freed span. Before the repair the
        // retired region rode the transition's after side verbatim and the
        // survivor's remapped region was dropped: the lane held no region.
        expect(liveLane().takes).toEqual([{ ...keeperTake, startBeat: 2, endBeat: 6 }]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: keeperTake.id }]);
        const keeperClip = liveTrackClips()[0]!;
        expect(resolveClipsWithComping('track-1', [keeperClip]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [2, 6],
        ]);

        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
        transaction.undo();

        // Both regions come back exactly — the retired one rides only the
        // transition's before side, so the restore re-adds it once the
        // survivor's region has moved off the freed span.
        expect(liveLane().takes).toEqual([compedTake, keeperTake]);
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 2, endBeat: 6, takeId: compedTake.id },
            { startBeat: 6, endBeat: 10, takeId: keeperTake.id },
        ]);

        transaction.redo();

        expect(liveLane().takes).toEqual([{ ...keeperTake, startBeat: 2, endBeat: 6 }]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: keeperTake.id }]);
    });

    it('maps two regions of one take through a split, keeping them sorted and non-overlapping', () => {
        // One take comps its whole clip in two adjacent regions; the delete
        // splits both clip and take. The derived regions must stay a lawful
        // lane shape with no normalization pass to repair them.
        setTracks([createClip({ id: 'span', startBeat: 0, endBeat: 10 })]);
        const take = createTake('span', 'The take', 0, 10);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [
                { startBeat: 0, endBeat: 6, takeId: take.id },
                { startBeat: 6, endBeat: 10, takeId: take.id },
            ],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        const rightTakeId = `${take.id}:time-delete-right:2:6`;
        // The first region's portion left of the span keeps its beats and its
        // take; its portion right of the span is gone with the deleted
        // material. The second region lands whole on the minted fragment take.
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: take.id },
            { startBeat: 2, endBeat: 6, takeId: rightTakeId },
        ]);
        const clips = liveTrackClips();
        expect(resolveClipsWithComping('track-1', [...clips]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [2, 6],
        ]);
    });

    it('drops a take and its region when the deleted span consumes them, while splitting a spanning sibling take', () => {
        // takeB covers exactly the deleted span of the same clip takeA spans:
        // takeB and its region have no surviving material, takeA splits.
        setTracks([createClip({ id: 'span', startBeat: 0, endBeat: 10 })]);
        const takeA = createTake('span', 'Spanning', 0, 10);
        const takeB = createTake('span', 'Consumed', 2, 6);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [takeA, takeB],
            activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: takeB.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        const rightTakeId = `${takeA.id}:time-delete-right:2:6`;
        const rightClip = liveTrackClips()[1]!;
        expect(liveLane().takes).toEqual([
            { ...takeA, startBeat: 0, endBeat: 2 },
            { ...takeA, id: rightTakeId, clipId: rightClip.id, startBeat: 2, endBeat: 6 },
        ]);
        expect(liveLane().activeCompRegions).toEqual([]);

        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
        transaction.undo();

        // The consumed take and its region ride the transition's before side,
        // so undo puts both back.
        expect(liveLane().takes).toEqual([takeA, takeB]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: takeB.id }]);
    });

    it('clamps a stale region overhanging the deleted span instead of letting it swallow the remapped survivor', () => {
        // The stale region is wider than its take — a shape the store
        // tolerates — and overhangs the deleted span, while a sibling clip
        // ripples left across it. Carried verbatim it would overlap the
        // survivor's remapped region, leaving the after side unlawful for the
        // plan's own validator: undo would throw on the invalid inverse.
        setTracks([
            createClip({ id: 'stale-host', startBeat: 0, endBeat: 2 }),
            createClip({ id: 'survivor', startBeat: 8, endBeat: 12 }),
        ]);
        const staleTake = createTake('stale-host', 'Stale host', 0, 2);
        const survivorTake = createTake('survivor', 'Survivor', 8, 12);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [staleTake, survivorTake],
            activeCompRegions: [
                { startBeat: 0, endBeat: 6, takeId: staleTake.id },
                { startBeat: 8, endBeat: 12, takeId: survivorTake.id },
            ],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        // The stale region keeps only its beats left of the span; the
        // survivor's region lands whole on the freed span.
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: staleTake.id },
            { startBeat: 4, endBeat: 8, takeId: survivorTake.id },
        ]);

        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });
        transaction.undo();

        // The before side carried the stale region verbatim, so undo restores
        // it exactly — overhang included.
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 6, takeId: staleTake.id },
            { startBeat: 8, endBeat: 12, takeId: survivorTake.id },
        ]);

        transaction.redo();

        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: staleTake.id },
            { startBeat: 4, endBeat: 8, takeId: survivorTake.id },
        ]);
    });

    it('records no re-key transition for a lane whose only take and region retire with their clip', () => {
        // The lane's only take comps a clip the span fully removes, while a
        // sibling clip ripples left. The retirement leg owns the doomed take
        // and region wholesale: the re-key capture must not emit a transition
        // for this lane.
        setTracks([
            createClip({ id: 'doomed', startBeat: 2, endBeat: 6 }),
            createClip({ id: 'survivor', startBeat: 8, endBeat: 12 }),
        ]);
        const doomedTake = createTake('doomed', 'Doomed', 2, 6);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [doomedTake],
            activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: doomedTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        const slot = applied.inversePlan.takeLanes as { reKeyedLanes?: unknown } | null;
        expect(slot).not.toBeNull();
        expect(slot?.reKeyedLanes ?? []).toEqual([]);
    });

    it('clamps a stale-wide region when the clamp is the lane’s only change', () => {
        // The host clip is untouched left of the span, and the rippling mover
        // owns no take: the stale region's clamp is the lane's only change.
        // Without it the lane rides no transition at all and keeps advancing
        // the comp cursor over the deleted span.
        setTracks([
            createClip({ id: 'stale-host', startBeat: 0, endBeat: 2 }),
            createClip({ id: 'mover', startBeat: 8, endBeat: 12 }),
        ]);
        const take = createTake('stale-host', 'Stale host', 0, 2);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [{ startBeat: 0, endBeat: 6, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        // The portion left of the span keeps its beats; the overhang into the
        // deleted span is gone.
        expect(liveLane().takes).toEqual([take]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 0, endBeat: 2, takeId: take.id }]);
        expect(applied.inversePlan).toMatchObject({
            takeLanes: {
                reKeyedLanes: [
                    {
                        regionsBefore: [{ startBeat: 0, endBeat: 6, takeId: take.id }],
                        regionsAfter: [{ startBeat: 0, endBeat: 2, takeId: take.id }],
                    },
                ],
            },
        });
    });

    it('drops a stale region that claims only beats inside the deleted span', () => {
        // Same stale shape, but the region sits wholly inside the span: none
        // of its material survives on either route, so the after side drops it
        // instead of keeping a comp over deleted beats.
        setTracks([
            createClip({ id: 'stale-host', startBeat: 0, endBeat: 2 }),
            createClip({ id: 'mover', startBeat: 8, endBeat: 12 }),
        ]);
        const take = createTake('stale-host', 'Stale host', 0, 2);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [{ startBeat: 3, endBeat: 5, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        expect(liveLane().takes).toEqual([take]);
        expect(liveLane().activeCompRegions).toEqual([]);
        const slot = applied.inversePlan.takeLanes as { reKeyedLanes?: Array<{ regionsAfter: unknown }> } | null;
        expect(slot?.reKeyedLanes?.[0]?.regionsAfter).toEqual([]);
    });

    it('drops a stale region that starts at the deleted span’s left edge', () => {
        // Nothing of the region is left of the span, so there is no left
        // portion to keep; the rest claims deleted material. A clamp that
        // treated the boundary beat as interior would emit a zero-width
        // region — the write half filters those, so only the plan itself
        // shows it.
        setTracks([
            createClip({ id: 'stale-host', startBeat: 0, endBeat: 2 }),
            createClip({ id: 'mover', startBeat: 8, endBeat: 12 }),
        ]);
        const take = createTake('stale-host', 'Stale host', 0, 2);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        const slot = applied.inversePlan.takeLanes as { reKeyedLanes?: Array<{ regionsAfter: unknown }> } | null;
        expect(slot?.reKeyedLanes?.[0]?.regionsAfter).toEqual([]);
        expect(liveLane().activeCompRegions).toEqual([]);
    });

    it('emits no transition for a stale region that ends at the deleted span’s left edge', () => {
        // The overhang ends exactly where the deletion starts: the region is
        // already correct on the after side, so carrying it through a
        // transition would record a no-op.
        setTracks([
            createClip({ id: 'stale-host', startBeat: 0, endBeat: 1 }),
            createClip({ id: 'mover', startBeat: 8, endBeat: 12 }),
        ]);
        const take = createTake('stale-host', 'Stale host', 0, 1);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 0, endBeat: 2, takeId: take.id }]);
        expect(applied.inversePlan).toMatchObject({ takeLanes: null });
    });

    it('drops a stale region wholly right of the span when a sibling clip ripples left', () => {
        // The stale region sits wholly right of the span, but the track is
        // not unmoved: the sibling mover ripples left across the freed span.
        // The verbatim guarantee is track-level, so the region leaves the
        // lane — a verbatim tail could overhang the rehomed material.
        setTracks([
            createClip({ id: 'stale-host', startBeat: 0, endBeat: 2 }),
            createClip({ id: 'mover', startBeat: 8, endBeat: 12 }),
        ]);
        const take = createTake('stale-host', 'Stale host', 0, 2);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } })
        );

        expect(liveLane().activeCompRegions).toEqual([]);
        const slot = applied.inversePlan.takeLanes as { reKeyedLanes?: Array<{ regionsAfter: unknown }> } | null;
        expect(slot?.reKeyedLanes?.[0]?.regionsAfter).toEqual([]);
    });

    it('drops a stale region wholly right of the span when the track carries mixed windows', () => {
        // The splitting clip contributes one unmoved window (its left piece)
        // and one shifted window (its right piece, rippled -4). The verbatim
        // guarantee requires every window unmoved; a `some` check would pass
        // on the left piece and let the stale region ride verbatim over
        // rippled beats.
        setTracks([
            createClip({ id: 'host', startBeat: 0, endBeat: 2 }),
            createClip({ id: 'span', startBeat: 2, endBeat: 12 }),
        ]);
        const take = createTake('host', 'Host take', 0, 2);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [take],
            activeCompRegions: [{ startBeat: 10, endBeat: 14, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        registerIdleDependencies();

        const applied = requireApplied(
            executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } })
        );

        expect(liveLane().activeCompRegions).toEqual([]);
        const slot = applied.inversePlan.takeLanes as { reKeyedLanes?: Array<{ regionsAfter: unknown }> } | null;
        expect(slot?.reKeyedLanes?.[0]?.regionsAfter).toEqual([]);
    });
});
