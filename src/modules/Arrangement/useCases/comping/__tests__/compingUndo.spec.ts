import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { addTake } from '../addTake';
import { addTakeLane } from '../addTakeLane';
import { flattenComp } from '../flattenComp';
import { removeCompRegion } from '../removeCompRegion';
import { selectTake } from '../selectTake';
import { setCompRegion } from '../setCompRegion';

const { pushUndoEntryMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn(),
}));

vi.mock('#/modules/Command/stores', () => ({
    pushUndoEntry: pushUndoEntryMock,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: { value: null, set: vi.fn() },
}));

describe('comping undo entries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('addTake pushes undo with the take name', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as TakeLaneStoreState;
        addTake('t1', 'clip-1', 'Take A', 0, 4);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Add take: Take A');
    });

    it('addTakeLane skips undo when the lane already exists', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as TakeLaneStoreState;
        addTakeLane('t1');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('addTakeLane pushes undo on creation', () => {
        takeLaneStore.value = { lanes: [] } as TakeLaneStoreState;
        addTakeLane('t1');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Add take lane');
    });

    it('selectTake skips undo when the take is already selected', () => {
        const lane = createTakeLane('t1');
        const take = { id: 'tk', clipId: 'c', name: 'n', startBeat: 0, endBeat: 1, selected: true };
        takeLaneStore.value = { lanes: [{ ...lane, takes: [take] }] } as TakeLaneStoreState;
        selectTake('t1', 'tk');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('selectTake pushes undo when the selected take changes', () => {
        const lane = createTakeLane('t1');
        const takeA = { id: 'a', clipId: 'c', name: 'A', startBeat: 0, endBeat: 1, selected: true };
        const takeB = { id: 'b', clipId: 'c', name: 'B', startBeat: 1, endBeat: 2, selected: false };
        takeLaneStore.value = { lanes: [{ ...lane, takes: [takeA, takeB] }] } as TakeLaneStoreState;
        selectTake('t1', 'b');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Select take');
    });

    it('setCompRegion skips undo when no lane matches the track', () => {
        takeLaneStore.value = { lanes: [] } as TakeLaneStoreState;
        setCompRegion('missing', { startBeat: 0, endBeat: 4, takeId: 'x' });
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('setCompRegion pushes undo when region is applied', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as TakeLaneStoreState;
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'x' });
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set comp region');
    });

    it('removeCompRegion skips undo when no matching region exists', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as TakeLaneStoreState;
        removeCompRegion('t1', 0);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('removeCompRegion pushes undo when a region is removed', () => {
        const lane = createTakeLane('t1');
        const region = { startBeat: 0, endBeat: 4, takeId: 'x' };
        takeLaneStore.value = { lanes: [{ ...lane, activeCompRegions: [region] }] } as TakeLaneStoreState;
        removeCompRegion('t1', 0);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Remove comp region');
    });

    it('flattenComp pushes a single undo entry covering the whole lane removal', () => {
        const laneA = createTakeLane('t1');
        const laneB = createTakeLane('t2');
        takeLaneStore.value = { lanes: [laneA, laneB] } as TakeLaneStoreState;
        flattenComp('t1');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Flatten comp');

        const [, undoFn] = pushUndoEntryMock.mock.calls[0]!;
        (undoFn as () => void)();
        const restoredArgs = vi.mocked(takeLaneStore.set).mock.lastCall?.[0] as TakeLaneStoreState | undefined;
        expect(restoredArgs?.lanes).toHaveLength(2);
    });
});
