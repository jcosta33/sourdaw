import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActionHistory } from '../clearActionHistory';

const module_mocks = vi.hoisted(() => ({
    clear_active_document: vi.fn<() => void>(),
    action_history_store: {
        clear: vi.fn<() => void>(),
        set: vi.fn<(state: { entries: unknown[] }) => void>(),
    },
}));

vi.mock('../../repositories/clearActionHistoryInActiveDocument', () => ({
    clearActionHistoryInActiveDocument: module_mocks.clear_active_document,
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    actionHistoryStore: module_mocks.action_history_store,
    defaultActionHistoryState: { entries: [] },
}));

describe('clearActionHistory', () => {
    beforeEach(() => {
        module_mocks.action_history_store.set.mockClear();
        module_mocks.action_history_store.clear.mockClear();
        module_mocks.clear_active_document.mockReset();
    });

    it('should clear all action-history entries', () => {
        clearActionHistory();

        expect(module_mocks.clear_active_document).toHaveBeenCalledTimes(1);
        expect(module_mocks.action_history_store.set).toHaveBeenCalledWith({ entries: [] });
        expect(module_mocks.clear_active_document.mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.action_history_store.set.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('should report target scrub failure without changing the in-memory projection', () => {
        const failure = new Error('target scrub failed');
        module_mocks.clear_active_document.mockImplementation(() => {
            throw failure;
        });

        expect(() => clearActionHistory()).toThrow(failure);

        expect(module_mocks.action_history_store.set).not.toHaveBeenCalled();
    });
});
