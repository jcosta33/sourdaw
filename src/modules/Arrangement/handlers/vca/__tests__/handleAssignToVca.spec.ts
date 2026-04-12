import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAssignToVca } from '../handleAssignToVca';

const mocks = vi.hoisted(() => ({
    assignToVca: vi.fn(),
}));

vi.mock('../../../useCases/vca/assignToVca', () => ({
    assignToVca: mocks.assignToVca,
}));

describe('handleAssignToVca', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes assignToVca with payload', () => {
        handleAssignToVca.execute({
            type: 'assignToVca',
            payload: { trackId: 't1', vcaGroupId: 'vca1' },
        });

        expect(mocks.assignToVca).toHaveBeenCalledWith('t1', 'vca1');
    });

    it('is undoable', () => {
        expect(handleAssignToVca.undoable).toBe(true);
    });
});
