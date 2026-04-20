import { describe, it, expect, vi, beforeEach } from 'vitest';

import { revertAction } from '../revertAction/revertAction';

const executeAppAction = vi.fn();
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (...args: any[]) => executeAppAction(...args),
}));

const markEntryReverted = vi.fn();
const actionHistoryStore = { value: null as null | { entries: any[] } };
vi.mock('../../stores/actionHistoryStore', () => ({
    markEntryReverted: (...args: any[]) => markEntryReverted(...args),
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
