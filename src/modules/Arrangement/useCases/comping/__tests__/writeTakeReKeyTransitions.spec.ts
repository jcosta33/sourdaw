import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { getTrackStoreState } from '../../getTrackStoreState';
import { applyTakeReKeyTransitions } from '../applyTakeReKeyTransitions';
import { type TakeReKeyLaneTransition } from '../takeReKeyTransition';

const mocks = vi.hoisted(() => {
    const trackState = { value: null as unknown };
    return {
        takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
        trackState,
    };
});

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn((state: TakeLaneStoreState) => {
            mocks.takeLaneStoreValue.value = state;
        }),
    },
}));

// The write half reads the project-wide clip ids through this accessor, and
// only when a target take is missing from the live lane: the spy pins both
// when it fires and that it does not fire otherwise.
vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(() => mocks.trackState.value),
}));

/** A take split by a [2,6] delete: the left fragment keeps the id, the right mints the deterministic one. */
function splitFixture(clipId: string, trackId: string) {
    const take = createTake(clipId, 'The take', 0, 10);
    const leftTake = { ...take, startBeat: 0, endBeat: 2 };
    const rightTake = {
        ...take,
        id: `${take.id}:time-delete-right:2:6`,
        clipId: `${clipId}-right`,
        startBeat: 2,
        endBeat: 6,
    };
    // The live lane lost the right fragment take after the capture.
    const lane: TakeLane = { ...createTakeLane(trackId), takes: [leftTake] };
    return { take, leftTake, rightTake, lane };
}

function splitTransition(fixture: ReturnType<typeof splitFixture>, laneIndex: number): TakeReKeyLaneTransition {
    return {
        laneIndex,
        laneId: fixture.lane.id,
        trackId: fixture.lane.trackId,
        takesBefore: [fixture.take],
        takesAfter: [fixture.leftTake, fixture.rightTake],
        regionsBefore: [],
        regionsAfter: [],
    };
}

function liveLane(): TakeLane {
    const lane = mocks.takeLaneStoreValue.value?.lanes[0];
    if (!lane) {
        throw new Error('Expected the take lane to survive');
    }
    return lane;
}

describe('writeTakeReKeyTransitions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneStoreValue.value = null;
        mocks.trackState.value = null;
    });

    afterEach(() => {
        mocks.takeLaneStoreValue.value = null;
    });

    it('refuses to re-add a captured region that overlaps one authored after the capture', () => {
        const take = createTake('clip-1', 'The take', 4, 10);
        const reKeyedTake = { ...take, clipId: 'clip-1-frag', startBeat: 2, endBeat: 6 };
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [reKeyedTake],
            // A comp authored after the capture, overlapping the span the
            // transition's remapped region would claim: the store's
            // non-overlap law refuses the replay rather than displacing the
            // live comp.
            activeCompRegions: [{ startBeat: 3, endBeat: 7, takeId: take.id }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        const transition: TakeReKeyLaneTransition = {
            laneIndex: 0,
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [reKeyedTake],
            regionsBefore: [{ startBeat: 4, endBeat: 10, takeId: take.id }],
            regionsAfter: [{ startBeat: 2, endBeat: 6, takeId: take.id }],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([reKeyedTake]);
        expect(liveLane().activeCompRegions).toEqual([{ startBeat: 3, endBeat: 7, takeId: take.id }]);
        // The live lane already holds everything the transition may replay.
        expect(takeLaneStore.set).not.toHaveBeenCalled();
        // No target take is missing from the lane, so the liveness scan of the
        // project's clips never fires.
        expect(getTrackStoreState).not.toHaveBeenCalled();
    });

    it('writes a remapped region after a verbatim region that ends where the addition starts', () => {
        // The untouched take's region [0,4] rides both sides verbatim; the
        // rippled take's region lands at [4,8], touching it. The merge must
        // emit the kept region first — a boundary that passed only strictly
        // earlier regions would append the kept one after the addition and
        // write an unsorted lane.
        const untouchedTake = createTake('clip-1', 'Untouched', 0, 4);
        const rippledTake = createTake('clip-2', 'Rippled', 8, 12);
        const remappedTake = { ...rippledTake, startBeat: 4, endBeat: 8 };
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [untouchedTake, remappedTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: untouchedTake.id }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        const transition: TakeReKeyLaneTransition = {
            laneIndex: 0,
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [untouchedTake, rippledTake],
            takesAfter: [untouchedTake, remappedTake],
            regionsBefore: [
                { startBeat: 0, endBeat: 4, takeId: untouchedTake.id },
                { startBeat: 8, endBeat: 12, takeId: rippledTake.id },
            ],
            regionsAfter: [
                { startBeat: 0, endBeat: 4, takeId: untouchedTake.id },
                { startBeat: 4, endBeat: 8, takeId: rippledTake.id },
            ],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([untouchedTake, remappedTake]);
        expect(liveLane().activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 4, takeId: untouchedTake.id },
            { startBeat: 4, endBeat: 8, takeId: rippledTake.id },
        ]);
    });

    it('keeps a live take’s fields when the transition carries the take unchanged', () => {
        // The take is verbatim on both sides — the transition never owns it.
        // The live lane holds an edit that landed after the capture, and only
        // the transition's own deltas may move: the edit survives the replay.
        const take = createTake('clip-1', 'Original name', 4, 10);
        const editedTake = { ...take, name: 'Edited after capture', sourceOffsetBeats: 3 };
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [editedTake] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        const transition: TakeReKeyLaneTransition = {
            laneIndex: 0,
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [take],
            regionsBefore: [],
            regionsAfter: [],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([editedTake]);
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('re-adds missing fragment takes across two lanes with a single project-wide clip scan', () => {
        const first = splitFixture('clip-1', 'track-1');
        const second = splitFixture('clip-2', 'track-2');
        mocks.takeLaneStoreValue.value = { lanes: [first.lane, second.lane] };
        mocks.trackState.value = {
            tracks: [
                { id: 'track-1', clips: [{ id: 'clip-1' }, { id: 'clip-1-right' }] },
                { id: 'track-2', clips: [{ id: 'clip-2' }, { id: 'clip-2-right' }] },
            ],
        };

        applyTakeReKeyTransitions([splitTransition(first, 0), splitTransition(second, 1)]);

        const lanes = mocks.takeLaneStoreValue.value?.lanes;
        expect(lanes?.[0]?.takes).toEqual([first.leftTake, first.rightTake]);
        expect(lanes?.[1]?.takes).toEqual([second.leftTake, second.rightTake]);
        // Both lanes re-add a take, and the clip-id scan runs once per write —
        // a per-lane recompute would call it twice.
        expect(getTrackStoreState).toHaveBeenCalledTimes(1);
    });

    it('does not re-add a fragment take whose clip left the project', () => {
        const fixture = splitFixture('clip-1', 'track-1');
        mocks.takeLaneStoreValue.value = { lanes: [fixture.lane] };
        // clip-1-right is gone: a take whose clip is gone has no material to
        // resolve against, so the replay leaves it missing.
        mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [{ id: 'clip-1' }] }] };

        applyTakeReKeyTransitions([splitTransition(fixture, 0)]);

        expect(liveLane().takes).toEqual([fixture.leftTake]);
    });
});
