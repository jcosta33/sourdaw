import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addGroupTakeSet } from '../addGroupTakeSet';

type MockTakeSet = { id: string; name: string; pass: number; color: string; recordedAt: string };
type MockGroup = {
    id: string;
    name: string;
    trackIds: string[];
    takeSets: MockTakeSet[];
    activeTakeSetId: string | null;
    compRegions: unknown[];
};
type GroupState = { groups: MockGroup[]; activeGroupId: string | null };
type GroupHolder = { value: GroupState | null };

const mocks = vi.hoisted(() => {
    const holder: GroupHolder = { value: { groups: [], activeGroupId: null } };
    return {
        groupCompingStoreValue: holder,
        groupCompingStoreSet: vi.fn<(state: GroupState) => void>(),
        getNextTakeSetId: vi.fn<() => string>(() => 'ts-123'),
    };
});

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
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groupCompingStoreValue.value = { groups: [], activeGroupId: null };
    });

    it('adds a take set to the correct group and activates it when none is active', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [{ id: 'g1', name: 'Drums', trackIds: [], takeSets: [], activeTakeSetId: null, compRegions: [] }],
            activeGroupId: 'g1',
        };

        addGroupTakeSet('g1', 'Take 1');

        const setCall = mocks.groupCompingStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected groupCompingStore.set to be called');
        }
        const group = setCall[0].groups[0]!;
        expect(group.takeSets).toHaveLength(1);
        expect(group.takeSets[0]).toMatchObject({ id: 'ts-123', name: 'Take 1', pass: 1, color: '#f00' });
        // No active set yet -> the new take set becomes active.
        expect(group.activeTakeSetId).toBe('ts-123');
    });

    it('leaves the existing active take set when one is already chosen', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [
                {
                    id: 'g1',
                    name: 'Drums',
                    trackIds: [],
                    takeSets: [],
                    activeTakeSetId: 'previously-active',
                    compRegions: [],
                },
            ],
            activeGroupId: 'g1',
        };

        addGroupTakeSet('g1', 'Take 2');

        const setCall = mocks.groupCompingStoreSet.mock.calls[0]!;
        // activeTakeSetId ?? ts.id keeps the previously-active id.
        expect(setCall[0].groups[0]!.activeTakeSetId).toBe('previously-active');
    });

    it('does not modify unrelated groups and increments pass by existing count', () => {
        mocks.groupCompingStoreValue.value = {
            groups: [
                {
                    id: 'other',
                    name: 'Bass',
                    trackIds: [],
                    takeSets: [{ id: 'old', name: 'old', pass: 1, color: '#f00', recordedAt: '' }],
                    activeTakeSetId: 'old',
                    compRegions: [],
                },
                { id: 'g1', name: 'Drums', trackIds: [], takeSets: [], activeTakeSetId: null, compRegions: [] },
            ],
            activeGroupId: 'g1',
        };

        addGroupTakeSet('g1', 'Take 1');

        const setCall = mocks.groupCompingStoreSet.mock.calls[0]!;
        // Unrelated group passes through the map short-circuit unchanged.
        expect(setCall[0].groups[0]!.takeSets.map((t) => t.id)).toEqual(['old']);
        // Target group: pass = takeSets.length + 1 = 1, colour wraps modulo palette.
        const target = setCall[0].groups[1]!;
        expect(target.takeSets[0]).toMatchObject({ pass: 1, color: '#f00' });
    });

    it('is a no-op when the group-comping store has not loaded', () => {
        mocks.groupCompingStoreValue.value = null;

        addGroupTakeSet('g1', 'Take 1');

        expect(mocks.groupCompingStoreSet).not.toHaveBeenCalled();
        expect(mocks.getNextTakeSetId).not.toHaveBeenCalled();
    });
});
