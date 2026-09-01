import { describe, expect, it, vi } from 'vitest';

import { createRendererCrashRecovery } from '../rendererCrashRecovery.js';

describe('renderer crash recovery', () => {
    it('creates the replacement, transfers its supported pending queue, then tears down the crashed renderer', () => {
        const crashed = { id: 'crashed' };
        const replacement = { id: 'replacement' };
        const order: string[] = [];
        const recovery = createRendererCrashRecovery({
            shouldRecreate: () => true,
            createReplacement: () => {
                order.push('create');
                return replacement;
            },
            clearPending: vi.fn(),
            recoverPending: (from, to) => {
                expect(from).toBe(crashed);
                expect(to).toBe(replacement);
                order.push('transfer');
            },
            clearCurrent: vi.fn(),
            clearForNoWindow: vi.fn(),
            now: () => 1,
            maxRecreates: 3,
            recreateWindowMs: 60_000,
        });

        recovery.recover(crashed, () => order.push('destroy'), vi.fn());

        expect(order).toEqual(['create', 'transfer', 'destroy']);
    });

    it('clears rather than transfers the queue when close approval suppresses recovery', () => {
        const crashed = { id: 'crashed' };
        const clearPending = vi.fn();
        const recoverPending = vi.fn();
        const clearCurrent = vi.fn();
        const recovery = createRendererCrashRecovery({
            shouldRecreate: () => false,
            createReplacement: vi.fn(),
            clearPending,
            recoverPending,
            clearCurrent,
            clearForNoWindow: vi.fn(),
            now: () => 1,
            maxRecreates: 3,
            recreateWindowMs: 60_000,
        });

        recovery.recover(crashed, vi.fn(), vi.fn());

        expect(clearPending).toHaveBeenCalledWith(crashed);
        expect(recoverPending).not.toHaveBeenCalled();
        expect(clearCurrent).toHaveBeenCalledOnce();
    });

    it('clears retained close authority and the pending queue when the crash budget is exhausted', () => {
        const crashed = { id: 'crashed' };
        const clearPending = vi.fn();
        const clearForNoWindow = vi.fn();
        const recovery = createRendererCrashRecovery({
            shouldRecreate: () => true,
            createReplacement: vi.fn(() => ({ id: 'replacement' })),
            clearPending,
            recoverPending: vi.fn(),
            clearCurrent: vi.fn(),
            clearForNoWindow,
            now: () => 1,
            maxRecreates: 1,
            recreateWindowMs: 60_000,
        });

        recovery.recover(crashed, vi.fn(), vi.fn());
        recovery.recover(crashed, vi.fn(), vi.fn());

        expect(clearPending).toHaveBeenCalledWith(crashed);
        expect(clearForNoWindow).toHaveBeenCalledOnce();
    });
});
