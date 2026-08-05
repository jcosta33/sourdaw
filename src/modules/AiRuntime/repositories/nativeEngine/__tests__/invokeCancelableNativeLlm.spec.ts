import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: vi.fn(),
}));

import { tauriInvoke } from '#/utils/tauriBridge';

import { invokeCancelableNativeLlm } from '../invokeCancelableNativeLlm';

const mockedInvoke = vi.mocked(tauriInvoke);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('invokeCancelableNativeLlm — success', () => {
    it('returns the invocation result', async () => {
        mockedInvoke.mockResolvedValue({ result: 'ok' });
        const result = await invokeCancelableNativeLlm({
            command: 'generate',
            args: { prompt: 'test' },
            abortMessage: 'Aborted',
        });
        expect(result).toEqual({ result: 'ok' });
    });

    it('passes requestId in args when provided', async () => {
        mockedInvoke.mockResolvedValue('ok');
        await invokeCancelableNativeLlm({
            command: 'generate',
            args: { prompt: 'x' },
            requestId: 'req-123',
            abortMessage: 'Aborted',
        });
        const callArgs = mockedInvoke.mock.calls[0]?.[1];
        expect(callArgs?.requestId).toBe('req-123');
    });

    it('generates requestId when not provided', async () => {
        mockedInvoke.mockResolvedValue('ok');
        await invokeCancelableNativeLlm({
            command: 'generate',
            args: {},
            abortMessage: 'Aborted',
        });
        const callArgs = mockedInvoke.mock.calls[0]?.[1];
        expect(callArgs?.requestId).toBeTruthy();
    });
});

describe('invokeCancelableNativeLlm — signal abort', () => {
    it('throws when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            invokeCancelableNativeLlm({
                command: 'gen',
                args: {},
                signal: controller.signal,
                abortMessage: 'Cancelled',
            })
        ).rejects.toThrow();
    });

    it('throws AbortError when signal aborts during invocation', async () => {
        const controller = new AbortController();
        mockedInvoke.mockReturnValue(new Promise(() => {})); // never resolves
        const promise = invokeCancelableNativeLlm({
            command: 'gen',
            args: {},
            signal: controller.signal,
            abortMessage: 'User cancelled',
        });
        controller.abort();
        await expect(promise).rejects.toThrow('User cancelled');
        // Verify cancel command was sent
        expect(mockedInvoke).toHaveBeenCalledWith('cancel_native_llm_generation', expect.objectContaining({}));
    });
});

describe('invokeCancelableNativeLlm — timeout', () => {
    it('rejects with timeout message after timeoutMs', async () => {
        mockedInvoke.mockReturnValue(new Promise(() => {})); // never resolves
        const promise = invokeCancelableNativeLlm({
            command: 'gen',
            args: {},
            timeoutMs: 5000,
            abortMessage: 'Aborted',
        });
        vi.advanceTimersByTime(5000);
        await expect(promise).rejects.toThrow('Native inference timed out after 5000ms');
    });

    it('uses custom timeoutMessage when provided', async () => {
        mockedInvoke.mockReturnValue(new Promise(() => {}));
        const promise = invokeCancelableNativeLlm({
            command: 'gen',
            args: {},
            timeoutMs: 1000,
            timeoutMessage: 'Custom timeout',
            abortMessage: 'Aborted',
        });
        vi.advanceTimersByTime(1000);
        await expect(promise).rejects.toThrow('Custom timeout');
    });
});
