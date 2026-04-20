import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setActiveGroupTakeSet } from '../setActiveGroupTakeSet';

const mocks = vi.hoisted(() => ({
    groupCompingStoreValue: { value: { groups: [] } },
    groupCompingStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/groupComping', () => ({
    groupCompingStore: {
        get value() {
            return mocks.groupCompingStoreValue.value;
        },
        set: mocks.groupCompingStoreSet,
    },
}));

describe('setActiveGroupTakeSet', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates activeTakeSetId for the group', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1', activeTakeSetId: 'old' }],
        } as any;

        setActiveGroupTakeSet('g1', 'new');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledWith({
            groups: [{ id: 'g1', activeTakeSetId: 'new' }],
        });
    });
});
