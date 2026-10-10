import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { getTrackStoreState } from '../../getTrackStoreState';
import { applyTakeReKeyTransitions } from '../applyTakeReKeyTransitions';
import { restoreTakeReKeyTransitions } from '../restoreTakeReKeyTransitions';
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

function splitTransition(fixture: ReturnType<typeof splitFixture>): TakeReKeyLaneTransition {
    return {
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

    it('applies a canonical source-depth change even when the beat alias is unchanged', () => {
        const take = { ...createTake('clip-1', 'Take', 0, 4, 2), sourceOffsetSeconds: 1 };
        const next = { ...take, sourceOffsetSeconds: 2 };
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        applyTakeReKeyTransitions([
            {
                laneId: lane.id,
                trackId: lane.trackId,
                takesBefore: [take],
                takesAfter: [next],
                regionsBefore: [],
                regionsAfter: [],
            },
        ]);

        expect(liveLane().takes[0]?.sourceOffsetSeconds).toBe(2);
    });

    it.each([
        { field: 'anchor', moved: { passAnchorSeconds: -2 } },
        { field: 'depth', moved: { passDepthSeconds: 3 } },
    ])('moves a pass whose placement $field alone the transition changed, both ways', ({ moved }) => {
        // The two facets differ only in where the pass sounds against its
        // clip's media, or what it plays, so that field alone must mark the
        // take as moved.
        const pass = { ...createTake('clip-1', 'Pass 2', 0, 4, 4), passAnchorSeconds: 0, passDepthSeconds: 2 };
        const placedPass = { ...pass, ...moved };
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [pass] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        const transition: TakeReKeyLaneTransition = {
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [pass],
            takesAfter: [placedPass],
            regionsBefore: [],
            regionsAfter: [],
        };

        applyTakeReKeyTransitions([transition]);
        expect(liveLane().takes).toEqual([placedPass]);

        restoreTakeReKeyTransitions([transition]);
        expect(liveLane().takes).toEqual([pass]);
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

        applyTakeReKeyTransitions([splitTransition(first), splitTransition(second)]);

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

        applyTakeReKeyTransitions([splitTransition(fixture)]);

        expect(liveLane().takes).toEqual([fixture.leftTake]);
    });

    it('refuses to re-add a captured region whose take never made it to the live lane', () => {
        // The transition's after side comps [2,6] with a take whose clip left
        // the project: the take replay refuses it (no material to resolve
        // against), so its region must be refused too — added anyway, it would
        // advance the comp cursor over a span no live take covers.
        const deadTake = createTake('gone', 'Dead take', 2, 6);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [] }] };

        const transition: TakeReKeyLaneTransition = {
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [],
            takesAfter: [deadTake],
            regionsBefore: [],
            regionsAfter: [{ startBeat: 2, endBeat: 6, takeId: deadTake.id }],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([]);
        expect(liveLane().activeCompRegions).toEqual([]);
    });

    it('refuses to re-add a zero-width captured region', () => {
        // A zero-width region names a point, not a span: the store tolerates
        // the shape, but re-adding it would pin the comp cursor without
        // comping anything.
        const take = createTake('clip-1', 'The take', 0, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        const transition: TakeReKeyLaneTransition = {
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [take],
            regionsBefore: [],
            regionsAfter: [{ startBeat: 4, endBeat: 4, takeId: take.id }],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().activeCompRegions).toEqual([]);
    });

    it('keeps a live selection toggle when the transition re-keys the take', () => {
        // The take's clipId moves with the transition, but `selected` is
        // interaction state the operation never owns: a toggle that landed
        // after the capture survives the replay.
        const take = createTake('clip-1', 'The take', 0, 10);
        const reKeyedTake = { ...take, clipId: 'clip-1-frag', startBeat: 2, endBeat: 6 };
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [{ ...reKeyedTake, selected: true }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        const transition: TakeReKeyLaneTransition = {
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [reKeyedTake],
            regionsBefore: [],
            regionsAfter: [],
        };
        applyTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([{ ...reKeyedTake, selected: true }]);
    });

    it('finds the lane by track when a remove-add cycle gave it a fresh id', () => {
        // The lane was removed and re-added between capture and replay: a
        // fresh id, same track. The transition's laneId matches nothing, and
        // only the trackId fallback lands the restore on the re-created lane.
        const fixture = splitFixture('clip-1', 'track-1');
        const recreatedLane: TakeLane = { ...createTakeLane('track-1'), takes: [] };
        mocks.takeLaneStoreValue.value = { lanes: [recreatedLane] };
        mocks.trackState.value = {
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1' }, { id: 'clip-1-right' }] }],
        };

        restoreTakeReKeyTransitions([splitTransition(fixture)]);

        // The restore direction reconciles toward the pre-split facet: the
        // original take lands on the re-created lane.
        expect(liveLane().takes).toEqual([fixture.take]);
    });

    it('does not resurrect a verbatim-facet take a collaborator deleted after the capture', () => {
        // The take is identical on both transition facets, so the transition
        // never moved it: its absence from the live lane is a collaborator's
        // write the capture never recorded, and the restore leg must not undo
        // it — the resurrection doctrine reconcileLane documents.
        const take = createTake('clip-1', 'The take', 0, 10);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [{ id: 'clip-1' }] }] };

        const transition: TakeReKeyLaneTransition = {
            laneId: lane.id,
            trackId: 'track-1',
            takesBefore: [take],
            takesAfter: [take],
            regionsBefore: [],
            regionsAfter: [],
        };
        restoreTakeReKeyTransitions([transition]);

        expect(liveLane().takes).toEqual([]);
    });
});
