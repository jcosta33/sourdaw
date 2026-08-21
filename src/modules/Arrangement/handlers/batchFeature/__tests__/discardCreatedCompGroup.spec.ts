import { beforeEach, describe, expect, it } from 'vitest';

import { type CompGroupEntry, groupCompingStore } from '../../../stores/groupComping';
import { handleDiscardCreatedCompGroup } from '../discardCreatedCompGroup';

function group(id: string, overrides?: Partial<CompGroupEntry>): CompGroupEntry {
    return {
        id,
        name: id,
        trackIds: [],
        takeSets: [],
        activeTakeSetId: null,
        compRegions: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// Exercised against the real groupComping store rather than a mock, so the guarded
// compare-and-swap — the whole point of this handler — is proven against actual writes.
describe('handleDiscardCreatedCompGroup', () => {
    beforeEach(() => {
        groupCompingStore.set({
            groups: [group('grp-existing'), group('grp-1')],
            activeGroupId: 'grp-1',
            defaultCrossfade: 0.125,
        });
    });

    it('removes exactly the named group and restores the previously active group id', () => {
        const result = handleDiscardCreatedCompGroup.execute({
            type: 'discardCreatedCompGroup',
            payload: { groupId: 'grp-1', expectedActiveGroupId: 'grp-1', replacementActiveGroupId: 'grp-existing' },
        });

        expect(result).toEqual({ status: 'written' });
        const state = groupCompingStore.value;
        expect(state?.groups.map((entry) => entry.id)).toEqual(['grp-existing']);
        expect(state?.activeGroupId).toBe('grp-existing');
    });

    it('conflicts and writes nothing when the active group changed since capture', () => {
        groupCompingStore.set({
            groups: [group('grp-existing'), group('grp-1')],
            activeGroupId: 'grp-existing',
            defaultCrossfade: 0.125,
        });

        const result = handleDiscardCreatedCompGroup.execute({
            type: 'discardCreatedCompGroup',
            payload: { groupId: 'grp-1', expectedActiveGroupId: 'grp-1', replacementActiveGroupId: null },
        });

        expect(result).toEqual({ status: 'conflict' });
        const state = groupCompingStore.value;
        expect(state?.groups.map((entry) => entry.id)).toEqual(['grp-existing', 'grp-1']);
        expect(state?.activeGroupId).toBe('grp-existing');
    });

    it('conflicts when the named group no longer exists', () => {
        const result = handleDiscardCreatedCompGroup.execute({
            type: 'discardCreatedCompGroup',
            payload: { groupId: 'grp-missing', expectedActiveGroupId: 'grp-1', replacementActiveGroupId: null },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('is an internal non-undoable compensation action', () => {
        expect(handleDiscardCreatedCompGroup.undoable).toBe(false);
    });
});
