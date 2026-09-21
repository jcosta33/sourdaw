import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { addTake } from '../addTake';
import { addTakeLane } from '../addTakeLane';
import { flattenComp } from '../flattenComp';
import { removeCompRegion } from '../removeCompRegion';

type PushedUndoEntry = { label: string; undo: () => void; redo: () => void };

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
    pushedUndoEntries: [] as PushedUndoEntry[],
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
    pushUndoEntry: (label: string, undo: () => void, redo: () => void) => {
        mocks.pushedUndoEntries.push({ label, undo, redo });
    },
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        // Assigning through the mock keeps the undo/redo closures reading the
        // same state the use cases wrote, like the real store.
        set: vi.fn((state: TakeLaneStoreState) => {
            mocks.takeLaneStoreValue.value = state;
        }),
    },
}));

function makeLane(trackId: string, withCompRegion = false): TakeLane {
    const lane = createTakeLane(trackId);
    const take = createTake(`clip-${trackId}`, `${trackId} take`, 0, 4);
    lane.takes = [{ ...take, selected: true }];
    if (withCompRegion) {
        lane.activeCompRegions = [{ startBeat: 0, endBeat: 4, takeId: take.id }];
    }
    return lane;
}

function seedLanes(lanes: readonly TakeLane[]): void {
    mocks.takeLaneStoreValue.value = { lanes: [...lanes] };
}

function getLane(trackId: string): TakeLane {
    const lane = mocks.takeLaneStoreValue.value?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!lane) {
        throw new Error(`Expected a take lane for ${trackId}`);
    }
    return lane;
}

function laneOrder(): readonly string[] {
    const lanes = mocks.takeLaneStoreValue.value?.lanes;
    if (!lanes) {
        throw new Error('Expected the take-lane store to hold lanes');
    }
    return lanes.map((lane) => lane.trackId);
}

function lastEntry(): PushedUndoEntry {
    const entry = mocks.pushedUndoEntries.at(-1);
    if (!entry) {
        throw new Error('Expected a pushed undo entry');
    }
    return entry;
}

/** Applies a later edit to one lane, written straight to the store. Mirrors
 *  how lane mutations land without routing through the entry under test's own
 *  undo capture — exactly the interleaved state a whole-store snapshot replay
 *  erased (#4081, same shape as the #4072 spec). */
function editLaneLater(trackId: string, renamedTakeName: string): void {
    const state = mocks.takeLaneStoreValue.value;
    if (!state) {
        throw new Error('Expected store state before the later edit');
    }
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.trackId !== trackId) {
                return lane;
            }
            return { ...lane, takes: lane.takes.map((take) => ({ ...take, name: renamedTakeName })) };
        }),
    });
}

describe('targeted take-lane undo entries (#4081)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneStoreValue.value = null;
        // The entries filter the takes they replay to those whose clips are still in
        // the project, so every case below needs the world its ids live in.
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 't1',
                    clips: ['clip-t1', 'clip-new'].map((id) => ClipDummy.create({ id, trackId: 't1' })),
                }),
                TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'clip-t2', trackId: 't2' })] }),
                TrackDummy.create({ id: 't3', clips: [ClipDummy.create({ id: 'clip-t3', trackId: 't3' })] }),
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        });
    });

    it('addTake undo removes only the added take and preserves later edits to another lane', () => {
        seedLanes([makeLane('t1'), makeLane('t2', true)]);

        addTake('t1', 'clip-new', 'New take', 4, 8);
        expect(getLane('t1').takes).toHaveLength(2);

        editLaneLater('t2', 'Renamed later');

        lastEntry().undo();
        expect(getLane('t1').takes).toHaveLength(1);
        expect(getLane('t1').takes[0]!.name).toBe('t1 take');
        expect(getLane('t2').takes[0]!.name).toBe('Renamed later');
        expect(getLane('t2').activeCompRegions).toHaveLength(1);

        lastEntry().redo();
        expect(getLane('t1').takes).toHaveLength(2);
        expect(getLane('t2').takes[0]!.name).toBe('Renamed later');
    });

    it('addTake undo preserves a later comp-region removal on the same lane', () => {
        seedLanes([makeLane('t1', true)]);

        addTake('t1', 'clip-new', 'New take', 4, 8);

        const state = mocks.takeLaneStoreValue.value;
        if (!state) {
            throw new Error('Expected store state after addTake');
        }
        takeLaneStore.set({
            lanes: state.lanes.map((lane) => (lane.trackId === 't1' ? { ...lane, activeCompRegions: [] } : lane)),
        });

        lastEntry().undo();
        expect(getLane('t1').takes).toHaveLength(1);
        expect(getLane('t1').activeCompRegions).toEqual([]);

        lastEntry().redo();
        expect(getLane('t1').takes).toHaveLength(2);
        expect(getLane('t1').activeCompRegions).toEqual([]);
    });

    it('addTakeLane undo removes only the added lane and preserves later edits to another lane', () => {
        seedLanes([makeLane('t1')]);

        addTakeLane('t2');
        expect(laneOrder()).toEqual(['t1', 't2']);

        editLaneLater('t1', 'Renamed later');

        lastEntry().undo();
        expect(laneOrder()).toEqual(['t1']);
        expect(getLane('t1').takes[0]!.name).toBe('Renamed later');

        lastEntry().redo();
        expect(laneOrder()).toEqual(['t1', 't2']);
        expect(getLane('t1').takes[0]!.name).toBe('Renamed later');
    });

    it('flattenComp undo restores the removed lane in its original position and preserves later edits elsewhere', () => {
        seedLanes([makeLane('t1'), makeLane('t2'), makeLane('t3')]);
        // Flatten reads the track to materialise the comp programme onto it;
        // a lane selecting nothing takes the lane-only route either way, which
        // is the route this test is about.
        trackStore.set({
            tracks: [TrackDummy.create({ id: 't2', clips: [] })],
            selectedTrackId: 't2',
            ghostClips: [],
        });

        flattenComp('t2');
        expect(laneOrder()).toEqual(['t1', 't3']);

        editLaneLater('t1', 'Renamed later');

        lastEntry().undo();
        expect(laneOrder()).toEqual(['t1', 't2', 't3']);
        expect(getLane('t1').takes[0]!.name).toBe('Renamed later');

        lastEntry().redo();
        expect(laneOrder()).toEqual(['t1', 't3']);
        expect(getLane('t1').takes[0]!.name).toBe('Renamed later');
    });

    it('removeCompRegion undo and redo rewrite only that lane and preserve later edits elsewhere', () => {
        seedLanes([makeLane('t1', true), makeLane('t2', true)]);

        removeCompRegion('t1', 0);
        expect(getLane('t1').activeCompRegions).toEqual([]);

        editLaneLater('t2', 'Renamed later');

        lastEntry().undo();
        expect(getLane('t1').activeCompRegions).toHaveLength(1);
        expect(getLane('t1').takes).toHaveLength(1);
        expect(getLane('t2').takes[0]!.name).toBe('Renamed later');

        lastEntry().redo();
        expect(getLane('t1').activeCompRegions).toEqual([]);
        expect(getLane('t2').takes[0]!.name).toBe('Renamed later');
    });
});
