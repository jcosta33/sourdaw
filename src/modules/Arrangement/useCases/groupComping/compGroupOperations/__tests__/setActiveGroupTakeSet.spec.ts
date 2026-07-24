import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setActiveGroupTakeSet } from '../setActiveGroupTakeSet';

type MockGroup = { id: string; activeTakeSetId: string };
type GroupHolder = { value: { groups: MockGroup[] } | null };

const mocks = vi.hoisted(() => {
    const holder: GroupHolder = { value: { groups: [] } };
    return {
        groupCompingStoreValue: holder,
        groupCompingStoreSet: vi.fn(),
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

describe('setActiveGroupTakeSet', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates activeTakeSetId for the group and leaves other groups untouched', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [
                { id: 'other', activeTakeSetId: 'keep' },
                { id: 'g1', activeTakeSetId: 'old' },
            ],
        };

        setActiveGroupTakeSet('g1', 'new');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledWith({
            groups: [
                { id: 'other', activeTakeSetId: 'keep' },
                { id: 'g1', activeTakeSetId: 'new' },
            ],
        });
    });

    it('is a no-op when the group-comping store has not loaded', () => {
        mocks.groupCompingStoreValue.value = null;

        setActiveGroupTakeSet('g1', 'new');

        expect(mocks.groupCompingStoreSet).not.toHaveBeenCalled();
    });
});
