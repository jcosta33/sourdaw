import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutomationLane, type AutomationPoint } from '../../../models/Automation';

import type * as CommandUseCases from '#/modules/Command/useCases';
import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): AutomationStoreState | null => state.value),
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
        pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => void) => void>(),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof CommandUseCases>();
    return {
        ...actual,
        executeUserAppAction: vi.fn(),
        pushUndoEntry: mocks.pushUndoEntry,
    };
});

const { deleteSelectedPoints } = await import('../deleteSelectedPoints');

function points(): AutomationPoint[] {
    return [
        { beat: 0, value: 0, curve: 'linear', tension: 0 },
        { beat: 4, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 8, value: 0.9, curve: 'linear', tension: 0 },
    ];
}

describe('deleteSelectedPoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'l1', points: points() }],
        };
    });

    it('removes the selected points and records an undo entry', () => {
        deleteSelectedPoints('l1', [4]);

        expect(mocks.state.value!.lanes[0]!.points.map((point) => point.beat)).toEqual([0, 8]);
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
            'Delete automation points',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('undo restores the deleted points in beat order', () => {
        deleteSelectedPoints('l1', [4]);
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;

        undoFn();

        expect(mocks.state.value!.lanes[0]!.points.map((point) => point.beat)).toEqual([0, 4, 8]);
    });

    it('redo removes the points again', () => {
        deleteSelectedPoints('l1', [4]);
        const [, undoFn, redoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        undoFn();

        redoFn();

        expect(mocks.state.value!.lanes[0]!.points.map((point) => point.beat)).toEqual([0, 8]);
    });

    it('does nothing when the lane is not found', () => {
        deleteSelectedPoints('missing', [4]);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('does nothing when the store is unavailable', () => {
        mocks.state.value = null;
        deleteSelectedPoints('l1', [4]);
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
