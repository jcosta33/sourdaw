import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { selectTake } from '../selectTake';

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

describe('selectTake', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        selectTake('t1', 'take-a');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('no-ops when the track has no lane', () => {
        mocks.takeLaneStoreValue.value = { lanes: [createTakeLane('other')] };

        selectTake('t1', 'take-a');

        expect(takeLaneStore.set).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('no-ops when the requested take is already selected', () => {
        const takeA = createTake('c1', 'A', 0, 4);
        // Simulate takeA being already the active selection.
        const lane = { ...createTakeLane('t1'), takes: [{ ...takeA, selected: true }] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        selectTake('t1', takeA.id);

        expect(takeLaneStore.set).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('marks the chosen take as selected on the track lane', () => {
        const takeA = createTake('c1', 'A', 0, 4);
        const takeB = createTake('c2', 'B', 0, 4);
        const lane = { ...createTakeLane('t1'), takes: [takeA, takeB] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        selectTake('t1', takeB.id);
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof lane)[] };
        const updated = next.lanes[0]!;
        expect(updated.takes.find((time) => time.id === takeA.id)?.selected).toBe(false);
        expect(updated.takes.find((time) => time.id === takeB.id)?.selected).toBe(true);
    });

    it('records undo/redo entries that restore the previous and next selection', () => {
        const takeA = createTake('c1', 'A', 0, 4);
        const takeB = createTake('c2', 'B', 0, 4);
        // takeA is currently selected; we switch to takeB.
        const lane = { ...createTakeLane('t1'), takes: [{ ...takeA, selected: true }, takeB] };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        selectTake('t1', takeB.id);

        const undoCall = mocks.pushUndoEntry.mock.calls[0];
        if (!undoCall) {
            throw new Error('expected pushUndoEntry to be called');
        }
        const [, undo, redo] = undoCall;

        // Undo restores the pre-select state (takeA selected); redo re-applies (takeB selected).
        undo();
        const undoArg = vi.mocked(takeLaneStore.set).mock.calls.at(-1)![0] as TakeLaneStoreState;
        const undoLane = undoArg.lanes.find((l) => l.trackId === 't1')!;
        expect(undoLane.takes.find((t) => t.id === takeA.id)?.selected).toBe(true);
        expect(undoLane.takes.find((t) => t.id === takeB.id)?.selected).toBe(false);

        redo();
        const redoArg = vi.mocked(takeLaneStore.set).mock.calls.at(-1)![0] as TakeLaneStoreState;
        const redoLane = redoArg.lanes.find((l) => l.trackId === 't1')!;
        expect(redoLane.takes.find((t) => t.id === takeA.id)?.selected).toBe(false);
        expect(redoLane.takes.find((t) => t.id === takeB.id)?.selected).toBe(true);
    });

    it('leaves unrelated lanes untouched while updating only the matching lane', () => {
        const takeA = createTake('c1', 'A', 0, 4);
        const targetLane = { ...createTakeLane('t1'), takes: [takeA] };
        const otherLane = createTakeLane('t2');
        mocks.takeLaneStoreValue.value = { lanes: [targetLane, otherLane] };

        selectTake('t1', takeA.id);

        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof otherLane)[] };
        // The non-matching lane is returned by reference, unchanged.
        expect(next.lanes[1]).toBe(otherLane);
    });
});
