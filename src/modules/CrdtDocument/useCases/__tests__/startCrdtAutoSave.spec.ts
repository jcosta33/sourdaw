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
});
