import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActionHistory } from '../clearActionHistory';

const module_mocks = vi.hoisted(() => ({
    action_history_store: {
        clear: vi.fn<() => void>(),
        set: vi.fn<(state: { entries: unknown[] }) => void>(),
    },
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    actionHistoryStore: module_mocks.action_history_store,
    defaultActionHistoryState: { entries: [] },
}));

describe('clearActionHistory', () => {
    beforeEach(() => {
        module_mocks.action_history_store.set.mockClear();
        module_mocks.action_history_store.clear.mockClear();
    });

    it('should clear all action-history entries', () => {
        clearActionHistory();

        expect(module_mocks.action_history_store.clear).toHaveBeenCalledTimes(1);
        expect(module_mocks.action_history_store.set).toHaveBeenCalledWith({ entries: [] });
        expect(module_mocks.action_history_store.clear.mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.action_history_store.set.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });
});
