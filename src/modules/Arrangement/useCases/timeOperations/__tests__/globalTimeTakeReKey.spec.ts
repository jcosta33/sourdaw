import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        takeLaneStore.set({ lanes: [] });
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
                        laneIndex: 0,
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
});
