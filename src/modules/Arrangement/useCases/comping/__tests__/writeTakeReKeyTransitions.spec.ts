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

    it('re-adds a fragment take missing from the lane when its clip is live', () => {
        const take = createTake('clip-1', 'The take', 0, 10);
        const leftTake = { ...take, startBeat: 0, endBeat: 2 };
        const rightTake = {
            ...take,
            id: `${take.id}:time-delete-right:2:6`,
            clipId: 'clip-1-right',
            startBeat: 2,
            endBeat: 6,
        };
        // The live lane lost the right fragment take after the capture.
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [leftTake] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [{ id: 'clip-1' }, { id: 'clip-1-right' }] }] };

        const transition: TakeReKeyLaneTransition = {
            laneIndex: 0,
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [leftTake, rightTake],
            regionsBefore: [],
            regionsAfter: [],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([leftTake, rightTake]);
        expect(getTrackStoreState).toHaveBeenCalledTimes(1);
    });

    it('does not re-add a fragment take whose clip left the project', () => {
        const take = createTake('clip-1', 'The take', 0, 10);
        const leftTake = { ...take, startBeat: 0, endBeat: 2 };
        const rightTake = {
            ...take,
            id: `${take.id}:time-delete-right:2:6`,
            clipId: 'clip-1-right',
            startBeat: 2,
            endBeat: 6,
        };
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [leftTake] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        // clip-1-right is gone: a take whose clip is gone has no material to
        // resolve against, so the replay leaves it missing.
        mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [{ id: 'clip-1' }] }] };

        const transition: TakeReKeyLaneTransition = {
            laneIndex: 0,
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [leftTake, rightTake],
            regionsBefore: [],
            regionsAfter: [],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([leftTake]);
    });
});
