import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCrdtAutoSave } from '../startCrdtAutoSave';

const { compactProject, logger, onChange, persistCrdtProject, unsubscribe } = vi.hoisted(() => ({
    compactProject: vi.fn<() => Promise<void>>(),
    logger: { error: vi.fn(), warn: vi.fn() },
    onChange: vi.fn<(listener: () => void) => () => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    unsubscribe: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: { onChange },
}));
vi.mock('../compactProject', () => ({ compactProject }));
vi.mock('../persistCrdtProject', () => ({ persistCrdtProject }));
vi.mock('#/infra/logger/appLogger', () => ({ logger }));

describe('startCrdtAutoSave', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        compactProject.mockReset().mockResolvedValue(undefined);
        persistCrdtProject.mockReset().mockResolvedValue(undefined);
        onChange.mockReset().mockReturnValue(unsubscribe);
        unsubscribe.mockClear();
        logger.error.mockClear();
        logger.warn.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('retries terminal project persistence without waiting for another repository change', async () => {
        compactProject
            .mockRejectedValueOnce(new Error('initial compact failed'))
            .mockRejectedValueOnce(new Error('compact recovery failed'))
            .mockResolvedValueOnce(undefined);
        persistCrdtProject.mockRejectedValueOnce(new Error('incremental recovery failed'));

        const stop = startCrdtAutoSave();

        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledTimes(2);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(249);
        expect(compactProject).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(compactProject).toHaveBeenCalledTimes(3);
        expect(onChange).toHaveBeenCalledOnce();

        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('caps repeated project durability retries and cancels them with the lifecycle', async () => {
        compactProject.mockRejectedValue(new Error('compact failed'));
        persistCrdtProject.mockRejectedValue(new Error('incremental recovery failed'));

        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);

        for (const delay of [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
            const callsBeforeRetry = compactProject.mock.calls.length;
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(compactProject).toHaveBeenCalledTimes(callsBeforeRetry);
            await vi.advanceTimersByTimeAsync(1);
            expect(compactProject).toHaveBeenCalledTimes(callsBeforeRetry + 2);
        }

        const callsAtCap = compactProject.mock.calls.length;
        await vi.advanceTimersByTimeAsync(29_999);
        expect(compactProject).toHaveBeenCalledTimes(callsAtCap);
        await vi.advanceTimersByTimeAsync(1);
        expect(compactProject).toHaveBeenCalledTimes(callsAtCap + 2);

        stop();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(compactProject).toHaveBeenCalledTimes(callsAtCap + 2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not continue an in-flight recovery chain after the lifecycle stops', async () => {
        let rejectFirstCompact: ((error: Error) => void) | undefined;
        compactProject.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectFirstCompact = reject;
                })
        );

        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        stop();
        const rejectCompact = rejectFirstCompact;
        if (!rejectCompact) {
            throw new Error('Expected the initial compact to be pending');
        }
        rejectCompact(new Error('compact failed after stop'));
        await vi.advanceTimersByTimeAsync(0);

        expect(compactProject).toHaveBeenCalledOnce();
        expect(persistCrdtProject).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps repository edits debounced after initial durability succeeds', async () => {
        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        const listener = onChange.mock.calls[0]?.[0];
        if (!listener) {
            throw new Error('Expected a repository change listener');
        }
        listener();
        await vi.advanceTimersByTimeAsync(1_000);
        listener();
        await vi.advanceTimersByTimeAsync(1_999);
        expect(persistCrdtProject).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(persistCrdtProject).toHaveBeenCalledOnce();

        stop();
    });

    it('caps persistence lag during continuous edits at the max-wait bound', async () => {
        // Regression (audit F1): a burst that keeps re-arming the debounce
        // must still persist within MAX_WAIT_MS of its first edit instead of
        // starving indefinitely.
        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        const listener = onChange.mock.calls[0]?.[0];
        if (!listener) {
            throw new Error('Expected a repository change listener');
        }

        // Edit once per second: the plain debounce never gets 2 s of idle.
        // Through t = 9 s persistence is still starved...
        for (let second = 0; second < 9; second++) {
            listener();
            await vi.advanceTimersByTimeAsync(1_000);
            expect(persistCrdtProject).not.toHaveBeenCalled();
        }

        // ...and one more edit at t = 9 s. The plain debounce would wait
        // until t = 11 s, but the cap (10 s from the burst's first edit)
        // forces the persist 1 s later.
        listener();
        await vi.advanceTimersByTimeAsync(999);
        expect(persistCrdtProject).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(persistCrdtProject).toHaveBeenCalledOnce();

        // A later edit starts a fresh burst with normal debounce semantics.
        listener();
        await vi.advanceTimersByTimeAsync(1_999);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(persistCrdtProject).toHaveBeenCalledTimes(2);

        stop();
    });

    it('flushes a pending debounced persist on pagehide and on visibility hidden', async () => {
        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        const listener = onChange.mock.calls[0]?.[0];
        if (!listener) {
            throw new Error('Expected a repository change listener');
        }

        // pagehide fires the pending persist immediately, without waiting
        // out the debounce.
        listener();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(persistCrdtProject).not.toHaveBeenCalled();
        window.dispatchEvent(new Event('pagehide'));
        expect(persistCrdtProject).toHaveBeenCalledOnce();

        // visibilitychange → hidden does the same for backgrounding (where
        // timers are throttled).
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        listener();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        document.dispatchEvent(new Event('visibilitychange'));
        expect(persistCrdtProject).toHaveBeenCalledTimes(2);
        visibility.mockRestore();

        // Nothing pending: pagehide is a no-op (no pointless write).
        window.dispatchEvent(new Event('pagehide'));
        expect(persistCrdtProject).toHaveBeenCalledTimes(2);

        // After stop, lifecycle listeners are gone.
        stop();
        listener();
        window.dispatchEvent(new Event('pagehide'));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(persistCrdtProject).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
});
