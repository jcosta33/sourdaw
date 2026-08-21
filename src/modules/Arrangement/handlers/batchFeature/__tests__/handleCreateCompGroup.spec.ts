import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateCompGroup } from '../handleCreateCompGroup';

const mocks = vi.hoisted(() => ({
    createCompGroup: vi.fn(),
    groupCompingStoreValue: { value: null as { activeGroupId: string | null } | null },
}));

vi.mock('../../../useCases/groupComping/compGroupOperations/createCompGroup', () => ({
    createCompGroup: mocks.createCompGroup,
}));

vi.mock('../../../stores/groupComping', () => ({
    groupCompingStore: {
        get value() {
            return mocks.groupCompingStoreValue.value;
        },
    },
}));

describe('handleCreateCompGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groupCompingStoreValue.value = null;
    });

    it('executes createCompGroup with name, trackIds and the materialized group id', () => {
        mocks.createCompGroup.mockReturnValue(true);

        const result = handleCreateCompGroup.execute({
            type: 'createCompGroup',
            payload: { name: 'Drums', trackIds: ['t1', 't2'], groupId: 'grp-1' },
        });

        expect(mocks.createCompGroup).toHaveBeenCalledWith('Drums', ['t1', 't2'], 'grp-1');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when the comp-group store was unavailable and no group was created', () => {
        // Reporting `written` here files an undo entry for a write that never happened.
        // Its inverse can only ever conflict, and a conflicted entry stays at the top of
        // the stack refusing every later undo press.
        mocks.createCompGroup.mockReturnValue(false);

        const result = handleCreateCompGroup.execute({
            type: 'createCompGroup',
            payload: { name: 'Drums', trackIds: ['t1'], groupId: 'grp-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleCreateCompGroup.describe({
            type: 'createCompGroup',
            payload: { name: 'Test', trackIds: [], groupId: 'grp-1' },
        });
        expect(desc.label).toBe('Create Comp Group');
    });

    it('emits an inverse naming exactly the materialized group id and the previously active group', () => {
        mocks.groupCompingStoreValue.value = { activeGroupId: 'grp-previous' };

        const desc = handleCreateCompGroup.describe({
            type: 'createCompGroup',
            payload: { name: 'Drums', trackIds: ['t1'], groupId: 'grp-1' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'discardCreatedCompGroup',
            payload: {
                groupId: 'grp-1',
                expectedActiveGroupId: 'grp-1',
                replacementActiveGroupId: 'grp-previous',
            },
        });
    });

    it('emits no inverse when the group id was never materialized', () => {
        const desc = handleCreateCompGroup.describe({
            type: 'createCompGroup',
            payload: { name: 'Drums', trackIds: ['t1'] },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleCreateCompGroup.undoable).toBe(true);
    });
});
