import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    insertTime: vi.fn(),
    prepareTimeOperationStateRestore: vi.fn(),
}));

vi.mock('../insertTime', () => ({
    insertTime: mocks.insertTime,
}));

vi.mock('../prepareTimeOperationStateRestore', () => ({
    prepareTimeOperationStateRestore: mocks.prepareTimeOperationStateRestore,
}));

import { executeUndoableInsertTime } from '../executeUndoableInsertTime';

describe('executeUndoableInsertTime', () => {
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
