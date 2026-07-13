import { beforeEach, describe, expect, it, vi } from 'vitest';

import { replaceBranchState } from '../replaceBranchState';

const mocks = vi.hoisted(() => ({
    branchStoreSet: vi.fn(),
    validateStoredBranchStoreState: vi.fn(),
}));

vi.mock('../../stores/branchStore', () => ({
    branchStore: { set: mocks.branchStoreSet },
    validateStoredBranchStoreState: mocks.validateStoredBranchStoreState,
}));

describe('replaceBranchState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should sanitize incoming branch state before replacing the branch store', () => {
        const incomingState = {
            branches: [{ branchId: 'untrusted' }],
            activeBranchId: 'untrusted',
        };
        const sanitizedState = {
            branches: [],
            activeBranchId: 'main',
        };
        mocks.validateStoredBranchStoreState.mockReturnValue(sanitizedState);

        replaceBranchState(incomingState);

        expect(mocks.validateStoredBranchStoreState).toHaveBeenCalledWith(incomingState);
        expect(mocks.branchStoreSet).toHaveBeenCalledWith(sanitizedState);
    });
});
