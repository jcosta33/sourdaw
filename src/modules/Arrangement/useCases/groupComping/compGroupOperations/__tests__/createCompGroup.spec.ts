import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCompGroup } from '../createCompGroup';

const mocks = vi.hoisted(() => {
    type Group = { id: string; name: string; trackIds: string[] };
    type State = { groups: Group[]; activeGroupId: string | null };
    type StateHolder = { value: State | null };
    const holder: StateHolder = { value: { groups: [], activeGroupId: null } };
    return {
        groupCompingStoreValue: holder,
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
        expect(createCompGroup('Drums', ['t1', 't2'])).toBe(true);

        expect(mocks.groupCompingStoreSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.groupCompingStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected groupCompingStore.set to be called');
        }
        const newState = setCall[0];
        expect(newState.groups).toHaveLength(1);
        expect(newState.groups[0]).toMatchObject({
            id: 'grp-123',
            name: 'Drums',
            trackIds: ['t1', 't2'],
        });
        expect(newState.activeGroupId).toBe('grp-123');
    });

    it('is a no-op when the group-comping store has not loaded, and says so', () => {
        mocks.groupCompingStoreValue.value = null;

        // The caller files an undo entry off this answer, so "nothing happened" has to
        // be reported rather than swallowed.
        expect(createCompGroup('Drums', ['t1'])).toBe(false);

        expect(mocks.groupCompingStoreSet).not.toHaveBeenCalled();
        // The id generator is never consulted when there is no store.
        expect(mocks.getNextGroupId).not.toHaveBeenCalled();
    });
});
