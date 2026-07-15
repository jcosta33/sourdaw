import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActionHistoryEntry } from '../../stores/actionHistoryStore';
import { recordActionHistoryEntry } from '../recordActionHistoryEntry';

const mocks = vi.hoisted(() => ({
    push_action_history_entry: vi.fn<(entry: ActionHistoryEntry) => string[]>(),
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    pushActionHistoryEntry: mocks.push_action_history_entry,
}));

describe('recordActionHistoryEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.push_action_history_entry.mockReturnValue([]);
    });

    it('should return metadata IDs evicted by the CrdtDocument history owner', () => {
        const entry: ActionHistoryEntry = {
            id: 'entry-1',
            label: 'Set tempo',
            actionKind: 'setTempo',
            source: 'manual',
            timestamp: 10,
            reverted: false,
        };
        mocks.push_action_history_entry.mockReturnValue(['evicted-entry']);

        const evicted_entry_ids = recordActionHistoryEntry(entry);

        expect(mocks.push_action_history_entry).toHaveBeenCalledWith(entry);
        expect(evicted_entry_ids).toEqual(['evicted-entry']);
    });
});
