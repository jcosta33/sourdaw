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
 * The #4520 arrangement: a clip the deleted span fully contains, comped by a
 * take with an active region, and a later clip on the same track that the
 * delete shifts left into exactly that span.
 */
function setCompedArrangement(): { compedTake: Take; keeperTake: Take; lane: TakeLane } {
    setTracks([
        createClip({ id: 'comped', startBeat: 2, endBeat: 6 }),
        createClip({ id: 'keeper', startBeat: 6, endBeat: 10 }),
    ]);
    const compedTake = createTake('comped', 'Comped take', 2, 6);
    const keeperTake = createTake('keeper', 'Keeper take', 6, 10);
    const lane: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [compedTake, keeperTake],
        activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: compedTake.id }],
    };
    takeLaneStore.set({ lanes: [lane] });
    return { compedTake, keeperTake, lane };
}

function liveTrackClips(): readonly Clip[] {
    const state = mocks.trackState.value as { tracks: Array<{ clips: Clip[] }> };
    return state.tracks[0]?.clips ?? [];
}

function requireApplied(result: ReturnType<typeof executeGlobalTimeOperation>) {
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') {
        throw new Error('Expected an applied global time operation');
    }
    return result;
}

describe('global time operations retire take-lane state (#4520)', () => {
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

    it('retires the take and comp region of a clip the deleted span fully contains', () => {
        const { compedTake, keeperTake, lane } = setCompedArrangement();
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        expect(liveTrackClips().map((clip) => clip.id)).toEqual(['keeper']);
        // The lane survives on its other take; the deleted clip's take and the
        // region naming it are gone.
        const lanes = takeLaneStore.value?.lanes ?? [];
        expect(lanes).toHaveLength(1);
        expect(lanes[0]?.id).toBe(lane.id);
        expect(lanes[0]?.takes.map((take) => take.id)).toEqual([keeperTake.id]);
        expect(lanes[0]?.activeCompRegions).toEqual([]);
        expect(lanes[0]?.takes.some((take) => take.id === compedTake.id)).toBe(false);
    });

    it('lets the clip shifted into the deleted span resolve its fragment instead of going silent', () => {
        setCompedArrangement();
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        const keeper = liveTrackClips()[0];
        expect(keeper?.startBeat).toBe(2);
        expect(keeper?.endBeat).toBe(6);
        if (!keeper) {
            throw new Error('Expected the keeper clip to survive');
        }
        // Before the fix the orphan region [2,6] still advanced the comp
        // cursor, so the shifted keeper was treated as already comped over its
        // whole span and resolved to nothing.
        const resolved = resolveClipsWithComping('track-1', [keeper]);
        expect(resolved.map((fragment) => [fragment.startBeat, fragment.endBeat])).toEqual([[2, 6]]);
    });

    it('retires the whole lane when the deleted clip held its last take', () => {
        setTracks([
            createClip({ id: 'comped', startBeat: 2, endBeat: 6 }),
            createClip({ id: 'keeper', startBeat: 6, endBeat: 10 }),
        ]);
        const compedTake = createTake('comped', 'Comped take', 2, 6);
        const lonelyLane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [compedTake],
            activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: compedTake.id }],
        };
        takeLaneStore.set({ lanes: [lonelyLane] });
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });

        expect(result.status).toBe('applied');
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('restores the retired lanes on undo and retires them again on redo', () => {
        const { compedTake, keeperTake, lane } = setCompedArrangement();
        registerIdleDependencies();

        const initialResult = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        const applied = requireApplied(initialResult);
        // The capture rides the inverse plan as plain JSON, like every other slot.
        const serializedPlan = JSON.stringify(applied.inversePlan);
        expect(JSON.parse(serializedPlan)).toEqual(applied.inversePlan);
        const transaction = createUndoableGlobalTimeOperation({ initialResult: applied });

        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([keeperTake.id]);

        transaction.undo();

        expect(liveTrackClips().map((clip) => clip.id)).toEqual(['comped', 'keeper']);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.id).toBe(lane.id);
        expect(restoredLane?.takes.map((take) => take.id)).toEqual([compedTake.id, keeperTake.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: compedTake.id }]);

        transaction.redo();

        expect(liveTrackClips().map((clip) => clip.id)).toEqual(['keeper']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([keeperTake.id]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([]);
        const keeper = liveTrackClips()[0];
        if (!keeper) {
            throw new Error('Expected the keeper clip to survive the redo');
        }
        expect(resolveClipsWithComping('track-1', [keeper]).map((fragment) => fragment.id)).toEqual(['keeper']);
    });

    it('carries the captured lanes in the inverse plan and flips them in the reversed plan', () => {
        const { compedTake, lane } = setCompedArrangement();
        registerIdleDependencies();

        const initialResult = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        const applied = requireApplied(initialResult);

        expect(applied.inversePlan).toMatchObject({
            takeLanes: {
                version: 1,
                appliedEffect: 'restore',
                removedClipIds: ['comped'],
                retiredLanes: [
                    {
                        laneIndex: 0,
                        retiredTakeIds: [compedTake.id],
                    },
                ],
            },
        });
        const slot = applied.inversePlan.takeLanes as {
            retiredLanes: Array<{ lane: TakeLane }>;
        };
        expect(slot.retiredLanes[0]?.lane.id).toBe(lane.id);
    });

    it("shifts a surviving clip's take geometry even when no take names the removed clip", () => {
        setTracks([
            createClip({ id: 'comped', startBeat: 2, endBeat: 6 }),
            createClip({ id: 'keeper', startBeat: 6, endBeat: 10 }),
        ]);
        const keeperTake = createTake('keeper', 'Keeper take', 6, 10);
        takeLaneStore.set({
            lanes: [{ ...createTakeLane('track-1'), takes: [keeperTake] }],
        });
        registerIdleDependencies();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 2, endBeat: 6 } });
        const applied = requireApplied(result);

        // No take named the deleted clip, so nothing retires — but the
        // keeper's take follows its clip to [2,6]: left at [6,10] it would
        // resolve against the clip's old span (#4841).
        const lanes = takeLaneStore.value?.lanes ?? [];
        expect(lanes[0]?.takes).toEqual([{ ...keeperTake, startBeat: 2, endBeat: 6 }]);
        expect(applied.inversePlan).toMatchObject({
            takeLanes: {
                removedClipIds: ['comped'],
                retiredLanes: [],
                reKeyedLanes: [{ trackId: 'track-1' }],
            },
        });
    });

    it('moves existing audio takes on insert and copies the comp for a contained duplicate', () => {
        const { compedTake } = setCompedArrangement();
        registerIdleDependencies();

        const inserted = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 0, durationBeats: 2 } });
        expect(inserted.status).toBe('applied');
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => [take.id, take.startBeat, take.endBeat])).toEqual([
            [compedTake.id, 4, 8],
            [expect.any(String), 8, 12],
        ]);

        const duplicated = executeGlobalTimeOperation({ operation: { type: 'duplicate', startBeat: 4, endBeat: 8 } });
        expect(duplicated.status).toBe('applied');
        const lanes = takeLaneStore.value?.lanes ?? [];
        expect(lanes[0]?.takes.map((take) => take.id)).toContain(compedTake.id);
        const copiedTake = lanes[0]?.takes.find((take) => take.clipId !== 'comped' && take.name === compedTake.name);
        expect(copiedTake).toMatchObject({ startBeat: 8, endBeat: 12 });
        expect(lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 4, endBeat: 8, takeId: compedTake.id },
            { startBeat: 8, endBeat: 12, takeId: copiedTake?.id },
        ]);
    });
});
