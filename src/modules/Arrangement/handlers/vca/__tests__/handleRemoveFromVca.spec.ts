import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveFromVca } from '../handleRemoveFromVca';

const mocks = vi.hoisted(() => ({
    removeFromVca: vi.fn(),
    toVcaGainExecutionResult: vi.fn(),
}));

vi.mock('../../../useCases/vca/removeFromVca', () => ({
    removeFromVca: mocks.removeFromVca,
}));

vi.mock('../toVcaGainExecutionResult', () => ({
    toVcaGainExecutionResult: mocks.toVcaGainExecutionResult,
}));

describe('handleRemoveFromVca', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.removeFromVca.mockReturnValue(true);
    });

    it('executes removeFromVca with trackId', () => {
        void handleRemoveFromVca.execute({
            type: 'removeFromVca',
            payload: { trackId: 't1' },
        });

        expect(mocks.removeFromVca).toHaveBeenCalledWith('t1');
        expect(mocks.toVcaGainExecutionResult).toHaveBeenCalledWith({
            groupIds: [],
            trackIds: ['t1'],
            status: 'written',
        });
    });

    it('is undoable', () => {
        expect(handleRemoveFromVca.undoable).toBe(true);
    });
});
