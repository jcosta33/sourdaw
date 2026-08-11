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

    it('restores the exact insert snapshot and reuses the captured replay identities', () => {
        const replayPlan = { version: 1 };
        const firstInverse = { version: 1, expected: 'inserted', replacement: 'before' };
        const replayInverse = { version: 1, expected: 'replayed', replacement: 'before' };
        const apply = vi.fn(() => true);
        mocks.insertTime
            .mockReturnValueOnce({
                status: 'applied',
                hasChanges: true,
                replayPlan,
                inversePlan: firstInverse,
            })
            .mockReturnValueOnce({
                status: 'applied',
                hasChanges: true,
                replayPlan,
                inversePlan: replayInverse,
            });
        mocks.prepareTimeOperationStateRestore.mockReturnValue({
            status: 'ready',
            hasChanges: true,
            apply,
        });

        const transaction = executeUndoableInsertTime(4, 2);
        expect(transaction).not.toBeNull();
        transaction?.undo();
        expect(mocks.prepareTimeOperationStateRestore).toHaveBeenLastCalledWith(firstInverse);
        expect(apply).toHaveBeenCalledOnce();

        transaction?.redo();
        expect(mocks.insertTime).toHaveBeenNthCalledWith(2, 4, 2, replayPlan);
        transaction?.undo();
        expect(mocks.prepareTimeOperationStateRestore).toHaveBeenLastCalledWith(replayInverse);
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

    it('fails closed when duplicate replay no longer matches project state', () => {
        const replayPlan = { version: 1 };
        const inversePlan = { version: 1, expected: 'duplicate', replacement: 'before' };
        mocks.duplicateTimeRange
            .mockReturnValueOnce({
                status: 'applied',
                hasChanges: true,
                replayPlan,
                inversePlan,
            })
            .mockReturnValueOnce({
                status: 'rejected',
                hasChanges: false,
                replayPlan: null,
                inversePlan: null,
            });
        mocks.prepareTimeOperationStateRestore.mockReturnValue({
            status: 'ready',
            hasChanges: false,
            apply: vi.fn(),
        });

        const transaction = executeUndoableDuplicateTimeRange(4, 8);

        expect(() => transaction?.redo()).toThrow('Global time operation redo conflicts with current project state');
        expect(mocks.duplicateTimeRange).toHaveBeenNthCalledWith(2, 4, 8, replayPlan);
        transaction?.undo();
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
