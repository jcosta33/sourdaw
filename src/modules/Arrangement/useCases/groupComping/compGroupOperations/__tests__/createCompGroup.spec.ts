import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCompGroup } from '../createCompGroup';

const mocks = vi.hoisted(() => {
    type Group = { id: string; name: string; trackIds: string[] };
    type State = { groups: Group[]; activeGroupId: string | null };
    return {
        groupCompingStoreValue: { value: { groups: [], activeGroupId: null } as State },
        groupCompingStoreSet: vi.fn<(state: State) => void>(),
        getNextGroupId: vi.fn<() => string>(() => 'grp-123'),
    };
});

vi.mock('#/modules/Arrangement/stores/groupComping', () => ({
    groupCompingStore: {
        get value() {
            return mocks.groupCompingStoreValue.value;
        },
        set: mocks.groupCompingStoreSet,
    },
    getNextGroupId: mocks.getNextGroupId,
}));

describe('createCompGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groupCompingStoreValue.value = { groups: [], activeGroupId: null };
    });

    it('creates a new comp group and sets it as active', () => {
        createCompGroup('Drums', ['t1', 't2']);

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.groupCompingStoreSet.mock.calls[0][0];
        expect(newState.groups).toHaveLength(1);
        expect(newState.groups[0]).toMatchObject({
            id: 'grp-123',
            name: 'Drums',
            trackIds: ['t1', 't2'],
        });
        expect(newState.activeGroupId).toBe('grp-123');
    });
});
