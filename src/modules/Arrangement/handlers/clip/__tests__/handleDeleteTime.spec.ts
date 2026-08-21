import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDeleteTime } from '../handleDeleteTime';

const mocks = vi.hoisted(() => ({
    deleteTime: vi.fn(),
    reverseRestorePlan: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/deleteTime', () => ({
    deleteTime: mocks.deleteTime,
}));
vi.mock('../../../useCases/timeOperations/reverseRestorePlan', () => ({
    reverseRestorePlan: mocks.reverseRestorePlan,
}));

const action = { type: 'deleteTime' as const, payload: { startBeat: 4, endBeat: 8 } };

describe('handleDeleteTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes deleteTime with the provided payload', () => {
        mocks.deleteTime.mockReturnValue({ status: 'no-change', hasChanges: false, inversePlan: null });

        void handleDeleteTime.execute(action);

        expect(mocks.deleteTime).toHaveBeenCalledWith(4, 8);
    });

    it('provides a description', () => {
        const desc = handleDeleteTime.describe(action);
        expect(desc.label).toBe('Delete time');
    });

    it('is undoable', () => {
        expect(handleDeleteTime.undoable).toBe(true);
    });

    it('finalizes the inverse and redo plan the describe result carries once the delete applies', () => {
        const inversePlan = { version: 1, scope: 'global', marker: 'undo-plan' };
        const redoPlan = { version: 1, scope: 'global', marker: 'redo-plan' };
        mocks.deleteTime.mockReturnValue({ status: 'applied', hasChanges: true, inversePlan });
        mocks.reverseRestorePlan.mockReturnValue(redoPlan);

        const description = handleDeleteTime.describe(action);
        const result = handleDeleteTime.execute(action);

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

    it('emits no inverse and reports no-write when the delete does not apply', () => {
        mocks.deleteTime.mockReturnValue({ status: 'no-change', hasChanges: false, inversePlan: null });

        const description = handleDeleteTime.describe(action);
        const result = handleDeleteTime.execute(action);

        expect(description.inverseAction).toBeNull();
        expect(description.redoAction).toBeUndefined();
        expect(result).toEqual({ status: 'no-write' });
    });
});
