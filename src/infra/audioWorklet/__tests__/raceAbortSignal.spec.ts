import { describe, expect, it } from 'vitest';

import { raceAbortSignal } from '../raceAbortSignal';

describe('raceAbortSignal', () => {
    it('passes through the promise result when no signal is provided', async () => {
        const result = await raceAbortSignal(Promise.resolve('ok'));
        expect(result).toBe('ok');
    });

    it('passes through the promise rejection when no signal is provided', async () => {
        await expect(raceAbortSignal(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    });

    it('resolves normally when the signal is not aborted and the promise completes', async () => {
        const controller = new AbortController();
        const result = await raceAbortSignal(Promise.resolve(42), controller.signal);
        expect(result).toBe(42);
    });

    it('throws the signal reason when already aborted before the call', async () => {
        const controller = new AbortController();
        const reason = new Error('Cancelled by user');
        controller.abort(reason);
        await expect(raceAbortSignal(Promise.resolve('ok'), controller.signal)).rejects.toThrow('Cancelled by user');
    });

    it('throws an AbortError DOMException when already aborted with no explicit reason', async () => {
        const controller = new AbortController();
        controller.abort();
        // When abort() is called without a reason, signal.reason is a DOMException
        // with message "This operation was aborted" — and since DOMException extends
        // Error, abortReason() returns it directly.
        await expect(raceAbortSignal(Promise.resolve('ok'), controller.signal)).rejects.toThrow(
            'This operation was aborted'
        );
    });

    it('aborts an in-flight promise when the signal fires after the race starts', async () => {
        const controller = new AbortController();
        const slowPromise = new Promise<string>((resolve) => {
            setTimeout(() => resolve('late'), 100);
        });
        const racePromise = raceAbortSignal(slowPromise, controller.signal);
        // Abort after the race has started
        setTimeout(() => controller.abort(), 10);
        await expect(racePromise).rejects.toThrow('This operation was aborted');
    });

    it('does not produce an unhandled rejection when the promise rejects after abort', async () => {
        const controller = new AbortController();
        const rejectingPromise = new Promise<string>((_resolve, reject) => {
            setTimeout(() => reject(new Error('late rejection')), 20);
        });
        controller.abort();
        // The abort wins synchronously; the late rejection should be swallowed
        await expect(raceAbortSignal(rejectingPromise, controller.signal)).rejects.toThrow(
            'This operation was aborted'
        );
        // Wait for the late rejection to settle without surfacing
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
});
