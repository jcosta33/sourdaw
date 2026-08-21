import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleInsertTime } from '../handleInsertTime';

const mocks = vi.hoisted(() => ({
    insertTime: vi.fn(),
    reverseRestorePlan: vi.fn(),
}));

vi.mock('../../../useCases/timeOperations/insertTime', () => ({
    insertTime: mocks.insertTime,
}));
vi.mock('../../../useCases/timeOperations/reverseRestorePlan', () => ({
    reverseRestorePlan: mocks.reverseRestorePlan,
}));

const action = { type: 'insertTime' as const, payload: { atBeat: 4, durationBeats: 2 } };

describe('handleInsertTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes insertTime with the provided payload', () => {
        mocks.insertTime.mockReturnValue({ status: 'no-change', hasChanges: false, inversePlan: null });

        void handleInsertTime.execute(action);

        expect(mocks.insertTime).toHaveBeenCalledWith(4, 2);
    });

    it('provides a description', () => {
        const desc = handleInsertTime.describe(action);
        expect(desc.label).toBe('Insert time');
    });

    it('is undoable', () => {
        expect(handleInsertTime.undoable).toBe(true);
    });

    it('finalizes the inverse and redo plan the describe result carries once the insert applies', () => {
        const inversePlan = { version: 1, scope: 'global', marker: 'undo-plan' };
        const redoPlan = { version: 1, scope: 'global', marker: 'redo-plan' };
        mocks.insertTime.mockReturnValue({ status: 'applied', hasChanges: true, inversePlan });
        mocks.reverseRestorePlan.mockReturnValue(redoPlan);

        const description = handleInsertTime.describe(action);
        const result = handleInsertTime.execute(action);

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

    it('emits no inverse and reports no-write when the insert does not apply', () => {
        mocks.insertTime.mockReturnValue({ status: 'no-change', hasChanges: false, inversePlan: null });

        const description = handleInsertTime.describe(action);
        const result = handleInsertTime.execute(action);

        expect(description.inverseAction).toBeNull();
        expect(description.redoAction).toBeUndefined();
        expect(result).toEqual({ status: 'no-write' });
    });
});
