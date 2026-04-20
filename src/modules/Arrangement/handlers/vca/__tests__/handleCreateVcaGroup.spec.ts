import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateVcaGroup } from '../handleCreateVcaGroup';

const mocks = vi.hoisted(() => ({
    createVcaGroup: vi.fn(),
}));

vi.mock('../../../useCases/vca/createVcaGroup', () => ({
    createVcaGroup: mocks.createVcaGroup,
}));

describe('handleCreateVcaGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createVcaGroup with payload', () => {
        handleCreateVcaGroup.execute({
            type: 'createVcaGroup',
            payload: { name: 'Drums VCA', trackIds: ['t1', 't2'] },
        });

        expect(mocks.createVcaGroup).toHaveBeenCalledWith('Drums VCA', ['t1', 't2']);
    });

    it('is undoable', () => {
        expect(handleCreateVcaGroup.undoable).toBe(true);
    });
});
