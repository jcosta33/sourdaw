import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markActionHistoryEntryReverted } from '../markActionHistoryEntryReverted';

const mocks = vi.hoisted(() => ({
    mark_entry_reverted: vi.fn<(entry_id: string) => void>(),
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    markEntryReverted: mocks.mark_entry_reverted,
}));

describe('markActionHistoryEntryReverted', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should mark the requested metadata row as reverted', () => {
        markActionHistoryEntryReverted('entry-1');

        expect(mocks.mark_entry_reverted).toHaveBeenCalledWith('entry-1');
    });
});
