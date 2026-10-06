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

    it('retries a failed incremental persist while the document is idle', async () => {
        persistCrdtProject.mockRejectedValueOnce(new Error('transient persist failure'));

        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        const listener = onChange.mock.calls[0]?.[0];
        if (!listener) {
            throw new Error('Expected a repository change listener');
        }
        listener();
        await vi.advanceTimersByTimeAsync(2_000);
        const failedPersist = persistCrdtProject.mock.results[0]?.value;
        if (!failedPersist) {
            throw new Error('Expected the incremental persist');
        }
        await failedPersist.catch(() => undefined);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.error).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(249);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(persistCrdtProject).toHaveBeenCalledTimes(2);
        const retriedPersist = persistCrdtProject.mock.results[1]?.value;
        if (!retriedPersist) {
            throw new Error('Expected the idle retry persist');
        }
        await retriedPersist;
        expect(vi.getTimerCount()).toBe(0);

        // A cleared streak warns for three further failures and errors on the fourth.
        persistCrdtProject.mockRejectedValue(new Error('later persist failure'));
        for (let attempt = 0; attempt < 3; attempt++) {
            listener();
            await vi.advanceTimersByTimeAsync(2_000);
            const laterFailure = persistCrdtProject.mock.results.at(-1)?.value;
            if (!laterFailure) {
                throw new Error('Expected the later incremental persist');
            }
            await laterFailure.catch(() => undefined);
        }
        expect(logger.error).not.toHaveBeenCalled();

        listener();
        await vi.advanceTimersByTimeAsync(2_000);
        const escalatedFailure = persistCrdtProject.mock.results.at(-1)?.value;
        if (!escalatedFailure) {
            throw new Error('Expected the escalated incremental persist');
        }
        await escalatedFailure.catch(() => undefined);
        expect(logger.error).toHaveBeenCalledOnce();

        stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not run a pending incremental retry after the auto-save lifecycle stops', async () => {
        persistCrdtProject.mockRejectedValue(new Error('persist failed'));

        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        const listener = onChange.mock.calls[0]?.[0];
        if (!listener) {
            throw new Error('Expected a repository change listener');
        }
        listener();
        await vi.advanceTimersByTimeAsync(2_000);
        const failedPersist = persistCrdtProject.mock.results[0]?.value;
        if (!failedPersist) {
            throw new Error('Expected the incremental persist');
        }
        await failedPersist.catch(() => undefined);
        expect(persistCrdtProject).toHaveBeenCalledOnce();

        stop();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('coalesces a pending incremental retry with a newer edit into one persist', async () => {
        persistCrdtProject.mockRejectedValueOnce(new Error('transient persist failure'));

        const stop = startCrdtAutoSave();
        await vi.advanceTimersByTimeAsync(0);
        expect(compactProject).toHaveBeenCalledOnce();

        const listener = onChange.mock.calls[0]?.[0];
        if (!listener) {
            throw new Error('Expected a repository change listener');
        }
        listener();
        await vi.advanceTimersByTimeAsync(2_000);
        const failedPersist = persistCrdtProject.mock.results[0]?.value;
        if (!failedPersist) {
            throw new Error('Expected the incremental persist');
        }
        await failedPersist.catch(() => undefined);
        expect(persistCrdtProject).toHaveBeenCalledOnce();

        listener();
        await vi.advanceTimersByTimeAsync(250);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1_750);
        expect(persistCrdtProject).toHaveBeenCalledTimes(2);
        const coalescedPersist = persistCrdtProject.mock.results[1]?.value;
        if (!coalescedPersist) {
            throw new Error('Expected the coalesced persist');
        }
        await coalescedPersist;

        stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries at the initial delay after edits cancel armed retries', async () => {
        persistCrdtProject.mockRejectedValue(new Error('persist failed'));

        const stop = startCrdtAutoSave();
        try {
            await vi.advanceTimersByTimeAsync(0);
            expect(compactProject).toHaveBeenCalledOnce();

            const listener = onChange.mock.calls[0]?.[0];
            if (!listener) {
                throw new Error('Expected a repository change listener');
            }

            for (let cycle = 0; cycle < 8; cycle++) {
                listener();
                await vi.advanceTimersByTimeAsync(2_000);
                const failedPersist = persistCrdtProject.mock.results.at(-1)?.value;
                if (!failedPersist) {
                    throw new Error('Expected the incremental persist');
                }
                await failedPersist.catch(() => undefined);
                expect(persistCrdtProject).toHaveBeenCalledTimes(cycle + 1);
                if (cycle < 7) {
                    listener();
                }
            }

            await vi.advanceTimersByTimeAsync(249);
            expect(persistCrdtProject).toHaveBeenCalledTimes(8);
            await vi.advanceTimersByTimeAsync(1);
            expect(persistCrdtProject).toHaveBeenCalledTimes(9);
        } finally {
            stop();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('flushes a pending incremental retry on pagehide and when the page is hidden', async () => {
        persistCrdtProject.mockRejectedValue(new Error('persist failed'));

        const stop = startCrdtAutoSave();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        try {
            await vi.advanceTimersByTimeAsync(0);
            expect(compactProject).toHaveBeenCalledOnce();

            const listener = onChange.mock.calls[0]?.[0];
            if (!listener) {
                throw new Error('Expected a repository change listener');
            }
            listener();
            await vi.advanceTimersByTimeAsync(2_000);
            const failedPersist = persistCrdtProject.mock.results[0]?.value;
            if (!failedPersist) {
                throw new Error('Expected the incremental persist');
            }
            await failedPersist.catch(() => undefined);
            expect(persistCrdtProject).toHaveBeenCalledOnce();

            window.dispatchEvent(new Event('pagehide'));
            expect(persistCrdtProject).toHaveBeenCalledTimes(2);
            const pageHidePersist = persistCrdtProject.mock.results[1]?.value;
            if (!pageHidePersist) {
                throw new Error('Expected the pagehide flush persist');
            }
            await pageHidePersist.catch(() => undefined);
            await vi.advanceTimersByTimeAsync(0);
            expect(persistCrdtProject).toHaveBeenCalledTimes(2);

            visibility.mockReturnValue('hidden');
            document.dispatchEvent(new Event('visibilitychange'));
            expect(persistCrdtProject).toHaveBeenCalledTimes(3);
        } finally {
            visibility.mockRestore();
            stop();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reruns one overlapping incremental persist after the in-flight save settles', async () => {
        let resolveInFlight: (() => void) | undefined;
        persistCrdtProject.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveInFlight = resolve;
                })
        );

        const stop = startCrdtAutoSave();
        try {
            await vi.advanceTimersByTimeAsync(0);
            expect(compactProject).toHaveBeenCalledOnce();

            const listener = onChange.mock.calls[0]?.[0];
            if (!listener) {
                throw new Error('Expected a repository change listener');
            }
            listener();
            await vi.advanceTimersByTimeAsync(2_000);
            expect(persistCrdtProject).toHaveBeenCalledOnce();
            const finishInFlight = resolveInFlight;
            if (!finishInFlight) {
                throw new Error('Expected the incremental persist to be pending');
            }

            listener();
            await vi.advanceTimersByTimeAsync(2_000);
            expect(persistCrdtProject).toHaveBeenCalledOnce();

            finishInFlight();
            await vi.advanceTimersByTimeAsync(0);
            expect(persistCrdtProject).toHaveBeenCalledTimes(2);
        } finally {
            stop();
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resets incremental retry backoff after a successful retry', async () => {
        persistCrdtProject.mockRejectedValue(new Error('persist failed'));

        const stop = startCrdtAutoSave();
        try {
            await vi.advanceTimersByTimeAsync(0);
            expect(compactProject).toHaveBeenCalledOnce();

            const listener = onChange.mock.calls[0]?.[0];
            if (!listener) {
                throw new Error('Expected a repository change listener');
            }
            listener();
            await vi.advanceTimersByTimeAsync(2_000);
            const firstFailure = persistCrdtProject.mock.results[0]?.value;
            if (!firstFailure) {
                throw new Error('Expected the incremental persist');
            }
            await firstFailure.catch(() => undefined);
            expect(persistCrdtProject).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(249);
            expect(persistCrdtProject).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            expect(persistCrdtProject).toHaveBeenCalledTimes(2);
            const firstRetry = persistCrdtProject.mock.results[1]?.value;
            if (!firstRetry) {
                throw new Error('Expected the first idle retry');
            }
            await firstRetry.catch(() => undefined);

            persistCrdtProject.mockResolvedValueOnce(undefined);
            await vi.advanceTimersByTimeAsync(499);
            expect(persistCrdtProject).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(persistCrdtProject).toHaveBeenCalledTimes(3);
            const successfulRetry = persistCrdtProject.mock.results[2]?.value;
            if (!successfulRetry) {
                throw new Error('Expected the successful idle retry');
            }
            await successfulRetry;

            persistCrdtProject.mockRejectedValueOnce(new Error('persist failed again'));
            listener();
            await vi.advanceTimersByTimeAsync(2_000);
            const laterFailure = persistCrdtProject.mock.results[3]?.value;
            if (!laterFailure) {
                throw new Error('Expected the later incremental persist');
            }
            await laterFailure.catch(() => undefined);
            expect(persistCrdtProject).toHaveBeenCalledTimes(4);

            await vi.advanceTimersByTimeAsync(249);
            expect(persistCrdtProject).toHaveBeenCalledTimes(4);
            await vi.advanceTimersByTimeAsync(1);
            expect(persistCrdtProject).toHaveBeenCalledTimes(5);
        } finally {
            stop();
        }
        expect(vi.getTimerCount()).toBe(0);
    });
});
