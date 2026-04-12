import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteCompGroup } from '../deleteCompGroup';

const mocks = vi.hoisted(() => ({
    groupCompingStoreValue: { value: { groups: [], activeGroupId: null } },
    groupCompingStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/groupComping', () => ({
    groupCompingStore: {
        get value() { return mocks.groupCompingStoreValue.value; },
        set: mocks.groupCompingStoreSet,
    },
}));

describe('deleteCompGroup', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes group and clears activeGroupId if it was the deleted group', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1' }, { id: 'g2' }],
            activeGroupId: 'g1',
        } as any;

        deleteCompGroup('g1');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledWith({
            groups: [{ id: 'g2' }],
            activeGroupId: null,
        });
    });

    it('removes group and keeps activeGroupId if it was NOT the deleted group', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1' }, { id: 'g2' }],
            activeGroupId: 'g2',
        } as any;

        deleteCompGroup('g1');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledWith({
            groups: [{ id: 'g2' }],
            activeGroupId: 'g2',
        });
    });
});
