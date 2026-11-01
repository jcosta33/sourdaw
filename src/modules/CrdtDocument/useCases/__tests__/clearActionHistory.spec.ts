import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActionHistory } from '../clearActionHistory';

const module_mocks = vi.hoisted(() => ({
    clear_active_document: vi.fn<() => void>(),
    clear_action_history_store: vi.fn<() => void>(),
}));

vi.mock('../../repositories/clearActionHistoryInActiveDocument', () => ({
    clearActionHistoryInActiveDocument: module_mocks.clear_active_document,
}));

vi.mock('../../stores/actionHistoryStore', () => ({
    clearActionHistoryStore: module_mocks.clear_action_history_store,
}));

describe('clearActionHistory', () => {
    beforeEach(() => {
        module_mocks.clear_action_history_store.mockClear();
        module_mocks.clear_active_document.mockReset();
    });

    it('should clear all action-history entries', () => {
        clearActionHistory();

        expect(module_mocks.clear_active_document).toHaveBeenCalledTimes(1);
        expect(module_mocks.clear_action_history_store).toHaveBeenCalledTimes(1);
        expect(module_mocks.clear_active_document.mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.clear_action_history_store.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('should report target scrub failure without changing the in-memory projection', () => {
        const failure = new Error('target scrub failed');
        module_mocks.clear_active_document.mockImplementation(() => {
            throw failure;
        });

        expect(() => clearActionHistory()).toThrow(failure);

        expect(module_mocks.clear_action_history_store).not.toHaveBeenCalled();
    });
});
