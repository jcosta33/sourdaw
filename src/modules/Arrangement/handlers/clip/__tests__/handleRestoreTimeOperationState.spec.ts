import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreTimeOperationState } from '../handleRestoreTimeOperationState';

const mocks = vi.hoisted(() => ({
    prepareTimeOperationStateRestore: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/prepareTimeOperationStateRestore', () => ({
    prepareTimeOperationStateRestore: mocks.prepareTimeOperationStateRestore,
}));

const plan = { version: 1 };
const action = { type: 'restoreTimeOperationState' as const, payload: { plan } };

describe('handleRestoreTimeOperationState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is not undoable', () => {
        expect(handleRestoreTimeOperationState.undoable).toBe(false);
    });

    it('provides a description with no inverse of its own', () => {
        const desc = handleRestoreTimeOperationState.describe(action);
        expect(desc).toEqual({ label: 'Restore time operation state', inverseAction: null });
    });

    it('applies and reports written when the plan is ready and has changes', () => {
        const apply = vi.fn().mockReturnValue(true);
        mocks.prepareTimeOperationStateRestore.mockReturnValue({ status: 'ready', hasChanges: true, apply });

        const result = handleRestoreTimeOperationState.execute(action);

        expect(mocks.prepareTimeOperationStateRestore).toHaveBeenCalledWith(plan);
        expect(apply).toHaveBeenCalled();
        expect(result).toEqual({ status: 'written' });
    });

    it('reports conflict when the plan is not ready — the divergence guard', () => {
        const apply = vi.fn();
        mocks.prepareTimeOperationStateRestore.mockReturnValue({ status: 'rejected', hasChanges: false, apply });

        const result = handleRestoreTimeOperationState.execute(action);

        expect(apply).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'conflict' });
    });

    it('reports no-write when the plan is ready but carries no changes', () => {
        const apply = vi.fn();
        mocks.prepareTimeOperationStateRestore.mockReturnValue({ status: 'ready', hasChanges: false, apply });

        const result = handleRestoreTimeOperationState.execute(action);

        expect(apply).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('reports conflict when apply() returns false', () => {
        const apply = vi.fn().mockReturnValue(false);
        mocks.prepareTimeOperationStateRestore.mockReturnValue({ status: 'ready', hasChanges: true, apply });

        const result = handleRestoreTimeOperationState.execute(action);

        expect(result).toEqual({ status: 'conflict' });
    });
});
