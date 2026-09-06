import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { setCompRegion } from '../setCompRegion';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
    pushUndoEntry: vi.fn<(label: string, undo: () => void, redo: () => void) => void>(),
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

describe('setCompRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when lane store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('appends a comp region for the matching track lane', () => {
        const lane = createTakeLane('t1');
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof lane)[] };
        expect(next.lanes[0]!.activeCompRegions).toHaveLength(1);
        expect(next.lanes[0]!.activeCompRegions[0]).toEqual({ startBeat: 0, endBeat: 4, takeId: 'take-a' });
    });

    it('is a no-op when no lane exists for the track', () => {
        mocks.takeLaneStoreValue.value = { lanes: [createTakeLane('other')] };

        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });

        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('removes overlapping regions and sorts the result by start beat', () => {
        const lane = createTakeLane('t1');
        lane.activeCompRegions = [
            { startBeat: 2, endBeat: 6, takeId: 'take-old' }, // overlaps [0,4)
            { startBeat: 8, endBeat: 12, takeId: 'keep' }, // disjoint, kept
        ];
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-new' });

        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof lane)[] };
        const regions = next.lanes[0]!.activeCompRegions;
        // overlapping region removed, new region inserted, kept region survives
        expect(regions).toEqual([
            { startBeat: 0, endBeat: 4, takeId: 'take-new' },
            { startBeat: 8, endBeat: 12, takeId: 'keep' },
        ]);
    });

    it('leaves unrelated lanes untouched when applying a region to one track', () => {
        const matchingLane = createTakeLane('t1');
        const otherLane = createTakeLane('t2');
        otherLane.activeCompRegions = [{ startBeat: 0, endBeat: 8, takeId: 'other-take' }];
        mocks.takeLaneStoreValue.value = { lanes: [matchingLane, otherLane] };

        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });

        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: ReturnType<typeof createTakeLane>[] };
        // The unrelated t2 lane is returned unchanged (the map short-circuit arm).
        expect(next.lanes[1]!.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 8, takeId: 'other-take' }]);
        expect(next.lanes[0]!.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: 'take-a' }]);
    });

    it('records undo/redo entries that restore the previous and next state', () => {
        const lane = createTakeLane('t1');
        lane.activeCompRegions = [{ startBeat: 0, endBeat: 4, takeId: 'take-old' }];
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        // New region overlaps the old one, so the old region is removed post-set.
        setCompRegion('t1', { startBeat: 2, endBeat: 6, takeId: 'take-new' });

        const undoCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoCall) {
            throw new Error('expected pushUndoEntry to be called');
        }
        const [, undo, redo] = undoCall;
        // Undo restores the pre-set lane list; redo restores the post-set list.
        undo();
        const undoArg = vi.mocked(takeLaneStore.set).mock.calls.at(-1)![0] as TakeLaneStoreState;
        expect(undoArg.lanes[0]!.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: 'take-old' }]);

        redo();
        const redoArg = vi.mocked(takeLaneStore.set).mock.calls.at(-1)![0] as TakeLaneStoreState;
        expect(redoArg.lanes[0]!.activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: 'take-new' }]);
    });
});
