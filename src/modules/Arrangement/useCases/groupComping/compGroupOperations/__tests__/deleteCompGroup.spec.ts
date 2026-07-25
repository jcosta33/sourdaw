import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteCompGroup } from '../deleteCompGroup';

import type { GroupCompingState } from '../../../../stores/groupComping';

const mocks = vi.hoisted(() => {
    const groupCompingStoreValue: { value: GroupCompingState | null } = {
        value: { groups: [], activeGroupId: null, defaultCrossfade: 0.125 },
    };
    return {
        groupCompingStoreValue,
        groupCompingStoreSet: vi.fn<(state: GroupCompingState) => void>(),
    };
});

vi.mock('#/modules/Arrangement/stores/groupComping', () => ({
    groupCompingStore: {
        get value() {
            return mocks.groupCompingStoreValue.value;
        },
        set: mocks.groupCompingStoreSet,
    },
}));

describe('deleteCompGroup', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes group and clears activeGroupId if it was the deleted group', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1' }, { id: 'g2' }],
            activeGroupId: 'g1',
        } as unknown as GroupCompingState;

        deleteCompGroup('g1');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledWith({
            groups: [{ id: 'g2' }],
            activeGroupId: null,
        } as unknown as GroupCompingState);
    });

    it('removes group and keeps activeGroupId if it was NOT the deleted group', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1' }, { id: 'g2' }],
            activeGroupId: 'g2',
        } as unknown as GroupCompingState;

        deleteCompGroup('g1');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledWith({
            groups: [{ id: 'g2' }],
            activeGroupId: 'g2',
        } as unknown as GroupCompingState);
    });

    it('is a no-op when the group-comping store holds no state', () => {
        mocks.groupCompingStoreValue.value = null;

        deleteCompGroup('g1');

        expect(mocks.groupCompingStoreSet).not.toHaveBeenCalled();
    });
});
