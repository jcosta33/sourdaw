import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateTimeRange } from '../handleDuplicateTimeRange';

const mocks = vi.hoisted(() => ({
    duplicateTimeRange: vi.fn(),
    reverseRestorePlan: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/duplicateTimeRange', () => ({
    duplicateTimeRange: mocks.duplicateTimeRange,
}));
vi.mock('../../../useCases/timeOperations/reverseRestorePlan', () => ({
    reverseRestorePlan: mocks.reverseRestorePlan,
}));

const action = { type: 'duplicateTimeRange' as const, payload: { startBeat: 4, endBeat: 8 } };

describe('handleDuplicateTimeRange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateTimeRange with the provided payload', () => {
        mocks.duplicateTimeRange.mockReturnValue({ status: 'no-change', hasChanges: false, inversePlan: null });

        void handleDuplicateTimeRange.execute(action);

        expect(mocks.duplicateTimeRange).toHaveBeenCalledWith(4, 8);
    });

    it('provides a description', () => {
        const desc = handleDuplicateTimeRange.describe(action);
        expect(desc.label).toBe('Duplicate time range');
    });

    it('is undoable', () => {
        expect(handleDuplicateTimeRange.undoable).toBe(true);
    });

    it('finalizes the inverse and redo plan the describe result carries once the duplication applies', () => {
        const inversePlan = { version: 1, scope: 'global', marker: 'undo-plan' };
        const redoPlan = { version: 1, scope: 'global', marker: 'redo-plan' };
        mocks.duplicateTimeRange.mockReturnValue({ status: 'applied', hasChanges: true, inversePlan });
        mocks.reverseRestorePlan.mockReturnValue(redoPlan);

        const description = handleDuplicateTimeRange.describe(action);
        const result = handleDuplicateTimeRange.execute(action);

        expect(mocks.reverseRestorePlan).toHaveBeenCalledWith(inversePlan);
        expect(description.inverseAction).toEqual({
            type: 'restoreTimeOperationState',
            payload: { plan: inversePlan },
        });
        expect(description.redoAction).toEqual({
            type: 'restoreTimeOperationState',
            payload: { plan: redoPlan },
        });
        // The undo plan and the redo plan must diverge — a handler that carried the same
        // plan on both sides would undo and redo into the exact same project state.
        expect(description.inverseAction).not.toEqual(description.redoAction);
        expect(result).toEqual({ status: 'written' });
    });

    it('emits no inverse and reports no-write when the duplication does not apply', () => {
        mocks.duplicateTimeRange.mockReturnValue({ status: 'no-change', hasChanges: false, inversePlan: null });

        const description = handleDuplicateTimeRange.describe(action);
        const result = handleDuplicateTimeRange.execute(action);

        expect(description.inverseAction).toBeNull();
        expect(description.redoAction).toBeUndefined();
        expect(result).toEqual({ status: 'no-write' });
    });
});
