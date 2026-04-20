import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateCompGroup } from '../handleCreateCompGroup';

const mocks = vi.hoisted(() => ({
    createCompGroup: vi.fn(),
}));

vi.mock('../../../useCases/groupComping/compGroupOperations/createCompGroup', () => ({
    createCompGroup: mocks.createCompGroup,
}));

describe('handleCreateCompGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createCompGroup with name and trackIds', () => {
        handleCreateCompGroup.execute({
            type: 'createCompGroup',
            payload: { name: 'Drums', trackIds: ['t1', 't2'] },
        });

        expect(mocks.createCompGroup).toHaveBeenCalledWith('Drums', ['t1', 't2']);
    });

    it('provides a description', () => {
        const desc = handleCreateCompGroup.describe({
            type: 'createCompGroup',
            payload: { name: 'Test', trackIds: [] },
        });
        expect(desc.label).toBe('Create Comp Group');
    });

    it('is undoable', () => {
        expect(handleCreateCompGroup.undoable).toBe(true);
    });
});
