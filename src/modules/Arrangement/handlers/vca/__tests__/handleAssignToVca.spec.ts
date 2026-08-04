import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAssignToVca } from '../handleAssignToVca';

const mocks = vi.hoisted(() => ({
    assignToVca: vi.fn(),
    toVcaGainExecutionResult: vi.fn(),
}));

vi.mock('../../../useCases/vca/assignToVca', () => ({
    assignToVca: mocks.assignToVca,
}));

vi.mock('../toVcaGainExecutionResult', () => ({
    toVcaGainExecutionResult: mocks.toVcaGainExecutionResult,
}));

describe('handleAssignToVca', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.assignToVca.mockReturnValue(true);
    });

    it('executes assignToVca with payload', () => {
        void handleAssignToVca.execute({
            type: 'assignToVca',
            payload: { trackId: 't1', vcaGroupId: 'vca1' },
        });

        expect(mocks.assignToVca).toHaveBeenCalledWith('t1', 'vca1');
        expect(mocks.toVcaGainExecutionResult).toHaveBeenCalledWith({
            groupIds: ['vca1'],
            trackIds: ['t1'],
            status: 'written',
        });
    });

    it('is undoable', () => {
        expect(handleAssignToVca.undoable).toBe(true);
    });
});
