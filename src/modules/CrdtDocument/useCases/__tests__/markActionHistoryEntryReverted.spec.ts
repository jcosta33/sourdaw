import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markActionHistoryEntryReverted } from '../markActionHistoryEntryReverted';

const mocks = vi.hoisted(() => ({
    mark_entry_reverted:
        vi.fn<(input: { entryId: string; expectedFingerprint: string }) => { status: 'marked' | 'unavailable' }>(),
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    markEntryReverted: mocks.mark_entry_reverted,
}));

describe('markActionHistoryEntryReverted', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should mark the requested metadata row as reverted', () => {
        mocks.mark_entry_reverted.mockReturnValue({ status: 'marked' });

        const result = markActionHistoryEntryReverted({
            entryId: 'entry-1',
            expectedFingerprint: '["entry-1","Set tempo","setTempo","manual",10,null,null]',
        });

        expect(result).toEqual({ status: 'marked' });
        expect(mocks.mark_entry_reverted).toHaveBeenCalledWith({
            entryId: 'entry-1',
            expectedFingerprint: '["entry-1","Set tempo","setTempo","manual",10,null,null]',
        });
    });
});
