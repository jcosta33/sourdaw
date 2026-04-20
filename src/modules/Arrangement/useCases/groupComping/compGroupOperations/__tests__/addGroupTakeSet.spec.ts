import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addGroupTakeSet } from '../addGroupTakeSet';

const mocks = vi.hoisted(() => ({
    groupCompingStoreValue: { value: { groups: [] } },
    groupCompingStoreSet: vi.fn(),
    getNextTakeSetId: vi.fn(() => 'ts-123'),
}));

vi.mock('#/modules/Arrangement/stores/groupComping', () => ({
    groupCompingStore: {
        get value() {
            return mocks.groupCompingStoreValue.value;
        },
        set: mocks.groupCompingStoreSet,
    },
    getNextTakeSetId: mocks.getNextTakeSetId,
    GROUP_COLORS: ['#f00', '#0f0'],
}));

describe('addGroupTakeSet', () => {
    beforeEach(() => vi.clearAllMocks());

    it('adds a take set to the correct group', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1', takeSets: [], activeTakeSetId: null }],
        } as any;

        addGroupTakeSet('g1', 'Take 1');

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledTimes(1);
        const group = mocks.groupCompingStoreSet.mock.calls[0][0].groups[0];
        expect(group.takeSets).toHaveLength(1);
        expect(group.takeSets[0]).toMatchObject({
            id: 'ts-123',
            name: 'Take 1',
            pass: 1,
        });
        expect(group.activeTakeSetId).toBe('ts-123');
    });
});
