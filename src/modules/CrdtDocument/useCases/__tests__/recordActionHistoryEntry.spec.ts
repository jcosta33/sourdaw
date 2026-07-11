import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActionHistoryEntry } from '../../stores/actionHistoryStore';
import { recordActionHistoryEntry } from '../recordActionHistoryEntry';

const mocks = vi.hoisted(() => ({
    push_action_history_entry: vi.fn<(entry: ActionHistoryEntry) => void>(),
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    pushActionHistoryEntry: mocks.push_action_history_entry,
}));

describe('recordActionHistoryEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate display metadata to the CrdtDocument history owner', () => {
        const entry: ActionHistoryEntry = {
            id: 'entry-1',
            label: 'Set tempo',
            actionKind: 'setTempo',
            source: 'manual',
            timestamp: 10,
            reverted: false,
        };

        recordActionHistoryEntry(entry);

        expect(mocks.push_action_history_entry).toHaveBeenCalledWith(entry);
    });
});
