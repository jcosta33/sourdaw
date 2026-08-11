import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    duplicateTimeRange: vi.fn(),
    prepareTimeOperationStateRestore: vi.fn(),
}));

vi.mock('../duplicateTimeRange', () => ({
    duplicateTimeRange: mocks.duplicateTimeRange,
}));

vi.mock('../prepareTimeOperationStateRestore', () => ({
    prepareTimeOperationStateRestore: mocks.prepareTimeOperationStateRestore,
}));

import { executeUndoableDuplicateTimeRange } from '../executeUndoableDuplicateTimeRange';

describe('executeUndoableDuplicateTimeRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
