import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCompGroup } from '../compGroupOperations/createCompGroup';

const mockSet = vi.fn();
let mockValue: any = null;

vi.mock('#/modules/Arrangement/stores/groupComping', () => ({
    groupCompingStore: {
        get value() { return mockValue; },
        set: (v: any) => mockSet(v)
    },
    getNextGroupId: () => 'grp-test',
    getNextTakeSetId: () => 'ts-1',
    getNextRegionId: () => 'gr-1',
    GROUP_COLORS: ['oklch(0.5 0.1 0)'],
}));

describe('compGroupOperations', () => {
    beforeEach(() => {
        mockSet.mockReset();
    });

    it('createCompGroup appends a group using injected id generation', () => {
        mockValue = { groups: [], activeGroupId: null, defaultCrossfade: 0.125 };

        createCompGroup('My Group', ['a', 'b']);

        expect(mockSet).toHaveBeenCalledTimes(1);
        const next = mockSet.mock.calls[0]![0] as {
            groups: { id: string; name: string; trackIds: string[] }[];
            activeGroupId: string;
        };
        expect(next.groups).toHaveLength(1);
        expect(next.groups[0]!.id).toBe('grp-test');
        expect(next.groups[0]!.name).toBe('My Group');
        expect(next.groups[0]!.trackIds).toEqual(['a', 'b']);
        expect(next.activeGroupId).toBe('grp-test');
    });
});
