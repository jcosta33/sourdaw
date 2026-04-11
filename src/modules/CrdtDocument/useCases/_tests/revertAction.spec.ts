import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { revertAction } from '../revertAction/revertAction';

describe('revertAction injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns false when history store is empty', async () => {
        const executeAppAction = vi.fn();
        const actionHistoryStore = { value: null as null };
        const markEntryReverted = vi.fn();
        injectDependencies(revertAction, { executeAppAction, actionHistoryStore, markEntryReverted });

        const ok = await revertAction('e1');

        expect(ok).toBe(false);
        expect(executeAppAction).not.toHaveBeenCalled();
    });
});
