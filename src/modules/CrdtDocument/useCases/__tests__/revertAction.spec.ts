import { describe, it, expect, vi, beforeEach } from 'vitest';

import { revertAction } from '../revertAction/revertAction';

const executeAppAction = vi.fn<(...args: unknown[]) => void>();
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (...args: unknown[]) => executeAppAction(...args),
}));

const markEntryReverted = vi.fn<(...args: unknown[]) => void>();
const actionHistoryStore = { value: null as null | { entries: unknown[] } };
vi.mock('../../stores/actionHistoryStore', () => ({
    markEntryReverted: (...args: unknown[]) => markEntryReverted(...args),
    get actionHistoryStore() {
        return actionHistoryStore;
    },
}));

describe('revertAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        actionHistoryStore.value = null;
    });

    it('returns false when history store is empty', async () => {
        const ok = await revertAction('e1');

        expect(ok).toBe(false);
        expect(executeAppAction).not.toHaveBeenCalled();
    });
});
