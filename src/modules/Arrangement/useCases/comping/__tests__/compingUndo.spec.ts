import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { addTake } from '../addTake';
import { addTakeLane } from '../addTakeLane';
import { flattenComp } from '../flattenComp';
import { removeCompRegion } from '../removeCompRegion';
import { selectTake } from '../selectTake';
import { setCompRegion } from '../setCompRegion';

const { pushUndoEntryMock, takeLaneStoreMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn(),
    takeLaneStoreMock: {
        value: null as TakeLaneStoreState | null,
        set: vi.fn<(value: TakeLaneStoreState | null) => void>(),
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: pushUndoEntryMock,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: takeLaneStoreMock,
}));

describe('comping undo entries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('addTake pushes undo with the take name', () => {
        const lane = createTakeLane('t1');
        takeLaneStoreMock.value = { lanes: [lane] };
        addTake('t1', 'clip-1', 'Take A', 0, 4);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Add take: Take A');
    });

    it('addTakeLane skips undo when the lane already exists', () => {
        const lane = createTakeLane('t1');
        takeLaneStoreMock.value = { lanes: [lane] };
        addTakeLane('t1');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('addTakeLane pushes undo on creation', () => {
        takeLaneStoreMock.value = { lanes: [] };
        addTakeLane('t1');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Add take lane');
    });

    it('selectTake skips undo when the take is already selected', () => {
        const lane = createTakeLane('t1');
        const take = { id: 'tk', clipId: 'c', name: 'n', startBeat: 0, endBeat: 1, selected: true };
        takeLaneStoreMock.value = { lanes: [{ ...lane, takes: [take] }] };
        selectTake('t1', 'tk');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('selectTake pushes undo when the selected take changes', () => {
        const lane = createTakeLane('t1');
        const takeA = { id: 'a', clipId: 'c', name: 'A', startBeat: 0, endBeat: 1, selected: true };
        const takeB = { id: 'b', clipId: 'c', name: 'B', startBeat: 1, endBeat: 2, selected: false };
        takeLaneStoreMock.value = { lanes: [{ ...lane, takes: [takeA, takeB] }] };
        selectTake('t1', 'b');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Select take');
    });

    it('setCompRegion skips undo when no lane matches the track', () => {
        takeLaneStoreMock.value = { lanes: [] };
        setCompRegion('missing', { startBeat: 0, endBeat: 4, takeId: 'x' });
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('setCompRegion pushes undo when region is applied', () => {
        const lane = createTakeLane('t1');
        takeLaneStoreMock.value = { lanes: [lane] };
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'x' });
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set comp region');
    });

    it('removeCompRegion skips undo when no matching region exists', () => {
        const lane = createTakeLane('t1');
        takeLaneStoreMock.value = { lanes: [lane] };
        removeCompRegion('t1', 0);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('removeCompRegion pushes undo when a region is removed', () => {
        const lane = createTakeLane('t1');
        const region = { startBeat: 0, endBeat: 4, takeId: 'x' };
        takeLaneStoreMock.value = { lanes: [{ ...lane, activeCompRegions: [region] }] };
        removeCompRegion('t1', 0);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Remove comp region');
    });

    it('flattenComp pushes a single undo entry covering the whole lane removal', () => {
        const laneA = createTakeLane('t1');
        const laneB = createTakeLane('t2');
        takeLaneStoreMock.value = { lanes: [laneA, laneB] };
        flattenComp('t1');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Flatten comp');

        const [, undoFn] = pushUndoEntryMock.mock.calls[0]!;
        (undoFn as () => void)();
        const restoredArgs = takeLaneStoreMock.set.mock.lastCall?.[0];
        expect(restoredArgs?.lanes).toHaveLength(2);
    });
});
