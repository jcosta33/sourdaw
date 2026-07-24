import { describe, it, expect, vi, beforeEach } from 'vitest';

import { bindTransactionAbortSignal } from '../bindTransactionAbortSignal';

/** Build a fake IDBTransaction whose abort() can throw a chosen error. */
function fakeTransaction(abortImpl: () => void = () => undefined): {
    transaction: IDBTransaction;
    abort: ReturnType<typeof vi.fn>;
} {
    const abort = vi.fn(abortImpl);
    const transaction = { abort } as unknown as IDBTransaction;
    return { transaction, abort };
}

describe('bindTransactionAbortSignal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a no-op detach and never touches the transaction when no signal is given', () => {
        const { transaction, abort } = fakeTransaction();

        const detach = bindTransactionAbortSignal(transaction);

        expect(detach).toBeInstanceOf(Function);
        expect(abort).not.toHaveBeenCalled();
        // Detach is safe to call and does nothing.
        expect(() => detach()).not.toThrow();
    });

    it('aborts the transaction immediately when the signal is already aborted', () => {
        const controller = new AbortController();
        controller.abort();
        const { transaction, abort } = fakeTransaction();

        bindTransactionAbortSignal(transaction, controller.signal);

        // The whole point: a superseded generation kills the in-flight tx
        // synchronously so its writes cannot land.
        expect(abort).toHaveBeenCalledTimes(1);
    });

    it('aborts the transaction when the signal fires later, registered as a one-shot listener', () => {
        const controller = new AbortController();
        const addSpy = vi.spyOn(controller.signal, 'addEventListener');
        const { transaction, abort } = fakeTransaction();

        bindTransactionAbortSignal(transaction, controller.signal);
        expect(abort).not.toHaveBeenCalled();
        // The listener must be registered with { once: true } so the AbortSignal
        // auto-removes it after firing — no lingering reference to a dead tx.
        expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });

        controller.abort();
        expect(abort).toHaveBeenCalledTimes(1);
    });

    it('detach removes the abort listener before the signal fires', () => {
        const controller = new AbortController();
        const { transaction, abort } = fakeTransaction();

        const detach = bindTransactionAbortSignal(transaction, controller.signal);
        detach();

        controller.abort();
        // The transaction was unbound; aborting the signal must not reach it.
        expect(abort).not.toHaveBeenCalled();
    });

    it('silently ignores an InvalidStateError when aborting an already-finished transaction', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const controller = new AbortController();
        const invalidStateError = new DOMException('already finished', 'InvalidStateError');
        const { transaction } = fakeTransaction(() => {
            throw invalidStateError;
        });

        bindTransactionAbortSignal(transaction, controller.signal);
        controller.abort();

        // A transaction that already committed/aborted throws InvalidStateError;
        // that is expected and must NOT be treated as a real failure.
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('logs a warning for a non-InvalidStateError abort failure', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const controller = new AbortController();
        const unexpected = new Error('transaction is read-only');
        const { transaction } = fakeTransaction(() => {
            throw unexpected;
        });

        bindTransactionAbortSignal(transaction, controller.signal);
        controller.abort();

        expect(warnSpy).toHaveBeenCalledTimes(1);
        // console.warn is called as ('[DEV][WARN]', message, error) by the logger.
        expect(warnSpy.mock.calls[0]?.[1]).toContain('Failed to abort superseded IDB transaction');
        warnSpy.mockRestore();
    });
});
