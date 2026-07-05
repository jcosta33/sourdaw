import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActionHistory } from '../clearActionHistory';

const module_mocks = vi.hoisted(() => ({
    action_history_store: {
        set: vi.fn<(state: { entries: unknown[] }) => void>(),
    },
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    actionHistoryStore: module_mocks.action_history_store,
}));

describe('clearActionHistory', () => {
    beforeEach(() => {
        module_mocks.action_history_store.set.mockClear();
    });

    it('should clear all action-history entries', () => {
        clearActionHistory();

        expect(module_mocks.action_history_store.set).toHaveBeenCalledWith({ entries: [] });
    });
});
