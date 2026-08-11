import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    duplicateTimeRange: vi.fn(),
    insertTime: vi.fn(),
    prepareTimeOperationStateRestore: vi.fn(),
}));

vi.mock('../duplicateTimeRange', () => ({
    duplicateTimeRange: mocks.duplicateTimeRange,
}));

vi.mock('../insertTime', () => ({
    insertTime: mocks.insertTime,
}));

vi.mock('../prepareTimeOperationStateRestore', () => ({
    prepareTimeOperationStateRestore: mocks.prepareTimeOperationStateRestore,
}));

import { executeUndoableDuplicateTimeRange } from '../executeUndoableDuplicateTimeRange';
import { executeUndoableInsertTime } from '../executeUndoableInsertTime';

describe('undoable global time operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores and redoes the exact captured insert snapshot', () => {
        const replayPlan = { version: 1 };
        const inversePlan = { version: 1, expected: 'inserted', replacement: 'before' };
        const apply = vi.fn(() => true);
        const revert = vi.fn(() => true);
        mocks.insertTime.mockReturnValue({
            status: 'applied',
            hasChanges: true,
            replayPlan,
            inversePlan,
        });
        mocks.prepareTimeOperationStateRestore.mockReturnValue({
            status: 'ready',
            hasChanges: true,
            apply,
            revert,
        });

        const transaction = executeUndoableInsertTime(4, 2);
        expect(transaction).not.toBeNull();
        transaction?.undo();
        expect(mocks.prepareTimeOperationStateRestore).toHaveBeenLastCalledWith(inversePlan);
        expect(apply).toHaveBeenCalledOnce();

        transaction?.redo();
        expect(revert).toHaveBeenCalledOnce();
        expect(mocks.insertTime).toHaveBeenCalledOnce();
        transaction?.undo();
        expect(mocks.prepareTimeOperationStateRestore).toHaveBeenLastCalledWith(inversePlan);
    });

    it('returns no transaction when duplicate preparation is rejected', () => {
        mocks.duplicateTimeRange.mockReturnValue({
            status: 'rejected',
            hasChanges: false,
            replayPlan: null,
            inversePlan: null,
        });

        expect(executeUndoableDuplicateTimeRange(4, 8)).toBeNull();
    });

    it('fails closed when the exact duplicate redo no longer matches project state', () => {
        const replayPlan = { version: 1 };
        const inversePlan = { version: 1, expected: 'duplicate', replacement: 'before' };
        const revert = vi.fn(() => false);
        mocks.duplicateTimeRange.mockReturnValue({
            status: 'applied',
            hasChanges: true,
            replayPlan,
            inversePlan,
        });
        mocks.prepareTimeOperationStateRestore.mockReturnValue({
            status: 'ready',
            hasChanges: true,
            apply: vi.fn(() => true),
            revert,
        });

        const transaction = executeUndoableDuplicateTimeRange(4, 8);

        transaction?.undo();
        expect(() => transaction?.redo()).toThrow('Global time operation redo conflicts with current project state');
        expect(revert).toHaveBeenCalledOnce();
        expect(mocks.duplicateTimeRange).toHaveBeenCalledOnce();
        expect(mocks.prepareTimeOperationStateRestore).toHaveBeenCalledWith(inversePlan);
    });

    it('fails closed when the exact inverse no longer matches project state', () => {
        mocks.insertTime.mockReturnValue({
            status: 'applied',
            hasChanges: true,
            replayPlan: { version: 1 },
            inversePlan: { version: 1 },
        });
        mocks.prepareTimeOperationStateRestore.mockReturnValue({
            status: 'rejected',
            hasChanges: false,
            apply: vi.fn(),
        });

        const transaction = executeUndoableInsertTime(4, 2);

        expect(() => transaction?.undo()).toThrow('Global time operation undo conflicts with current project state');
    });
});
