import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createCompGroup } from './compGroupOperations/createCompGroup';

describe('compGroupOperations', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('createCompGroup appends a group using injected id generation', () => {
        const set = vi.fn();
        injectDependencies(createCompGroup, {
            groupCompingStore: {
                value: { groups: [], activeGroupId: null, defaultCrossfade: 0.125 },
                set,
            },
            getNextGroupId: () => 'grp-test',
            getNextTakeSetId: () => 'ts-1',
            getNextRegionId: () => 'gr-1',
            GROUP_COLORS: ['oklch(0.5 0.1 0)'],
        });

        createCompGroup('My Group', ['a', 'b']);

        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as {
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
