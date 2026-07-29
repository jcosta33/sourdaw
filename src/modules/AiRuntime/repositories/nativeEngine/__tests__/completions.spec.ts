import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateNativeCompletion } from '../completions';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
    tauriInvoke: mocks.tauriInvoke,
}));

// Stub global fetch
vi.stubGlobal('fetch', mocks.fetch);

function getInvocationArgs(callIndex: number): Record<string, unknown> {
    const call: unknown = mocks.tauriInvoke.mock.calls[callIndex];
    if (!Array.isArray(call)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    const args: unknown = call[1];
    if (!isRecord(args)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('generateNativeCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('when running in Tauri', () => {
        beforeEach(() => {
            mocks.isTauri.mockReturnValue(true);
        });

        it('calls tauriInvoke with correct parameters', async () => {
            mocks.tauriInvoke.mockResolvedValue('Tauri response');

            const result = await generateNativeCompletion('system prompt', 'hello');

            expect(mocks.tauriInvoke.mock.calls[0]?.[0]).toBe('generate_native_completion');
            const invocationArgs = getInvocationArgs(0);
            expect(invocationArgs).toEqual({
                systemPrompt: 'system prompt',
                userMessage: 'hello',
                temperature: 0.1,
                maxTokens: 2048,
                requestId: invocationArgs.requestId,
            });
            expect(typeof invocationArgs.requestId).toBe('string');
            expect(result).toBe('Tauri response');
        });

        it('cancels the native request when the signal aborts', async () => {
            mocks.tauriInvoke.mockImplementation((command: string) => {
                if (command === 'generate_native_completion') {
                    return new Promise<never>(() => undefined);
                }
                return Promise.resolve(undefined);
            });
            const controller = new AbortController();
            const pending = generateNativeCompletion('system prompt', 'hello', { signal: controller.signal });

            controller.abort();

            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            expect(mocks.tauriInvoke.mock.calls[1]?.[0]).toBe('cancel_native_llm_generation');
            expect(getInvocationArgs(1).requestId).toBe(getInvocationArgs(0).requestId);
        });

        it('preserves the Tauri string contract when completion metadata is unavailable', async () => {
            mocks.tauriInvoke.mockResolvedValue('Tauri response');

            await expect(generateNativeCompletion('system prompt', 'hello', { requireComplete: true })).resolves.toBe(
                'Tauri response'
            );
            expect(getInvocationArgs(0)).not.toHaveProperty('requireComplete');
        });

        it('terminally rejects a non-string Tauri tool-planning response', async () => {
            mocks.tauriInvoke.mockResolvedValue({ content: 'unexpected envelope' });

            await expect(
                generateNativeCompletion('system prompt', 'hello', { requireComplete: true })
            ).rejects.toMatchObject({ name: 'ToolPlanningRejectedError' });
        });

        it('preserves the non-planning TypeError for a non-string Tauri response', async () => {
            mocks.tauriInvoke.mockResolvedValue({ content: 'unexpected envelope' });

            await expect(generateNativeCompletion('system prompt', 'hello')).rejects.toMatchObject({
                name: 'TypeError',
            });
        });
    });

    describe('when running in browser (dev mode)', () => {
        beforeEach(() => {
            mocks.isTauri.mockReturnValue(false);
        });

        it('calls localhost llama-server API', async () => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ choices: [{ message: { content: 'Fetch response' } }] }),
            });

            const result = await generateNativeCompletion('system prompt', 'hello');

            expect(mocks.fetch).toHaveBeenCalledWith('http://127.0.0.1:8847/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: 'system prompt' },
                        { role: 'user', content: 'hello' },
                    ],
                    temperature: 0.1,
                    max_tokens: 2048,
                    seed: 0,
                }),
            });
            expect(result).toBe('Fetch response');
        });

        it('throws an error if fetch fails', async () => {
            mocks.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: () => Promise.resolve('Internal Server Error'),
            });

            await expect(generateNativeCompletion('sys', 'user')).rejects.toThrow(
                'llama-server error 500: Internal Server Error'
            );
        });

        it('returns a terminal browser completion when strict completion is required', async () => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        choices: [{ finish_reason: 'stop', message: { content: '[{"name":"muteTrack"}]' } }],
                    }),
            });

            await expect(generateNativeCompletion('sys', 'user', { requireComplete: true })).resolves.toBe(
                '[{"name":"muteTrack"}]'
            );
        });

        it.each([
            {
                label: 'length finish',
                payload: {
                    choices: [{ finish_reason: 'length', message: { content: '[{"name":"muteTrack"}]' } }],
                },
            },
            { label: 'missing choice', payload: { choices: [] } },
            { label: 'missing message', payload: { choices: [{ finish_reason: 'stop' }] } },
            {
                label: 'null content',
                payload: { choices: [{ finish_reason: 'stop', message: { content: null } }] },
            },
            {
                label: 'missing finish state',
                payload: { choices: [{ message: { content: '[{"name":"muteTrack"}]' } }] },
            },
        ])('rejects a strict browser completion with $label', async ({ payload }) => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(payload),
            });

            await expect(generateNativeCompletion('sys', 'user', { requireComplete: true })).rejects.toMatchObject({
                name: 'ToolPlanningRejectedError',
            });
        });

        it('terminally rejects malformed JSON from a successful strict response', async () => {
            const syntaxError = new Error('Unexpected token');
            syntaxError.name = 'SyntaxError';
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.reject(syntaxError),
            });

            await expect(generateNativeCompletion('sys', 'user', { requireComplete: true })).rejects.toMatchObject({
                name: 'ToolPlanningRejectedError',
            });
        });

        it.each([
            { label: 'body stream failure', error: new TypeError('Body stream failed') },
            { label: 'abort', error: new DOMException('Aborted', 'AbortError') },
        ])('preserves a strict response $label as an operational failure', async ({ error }) => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.reject(error),
            });

            await expect(generateNativeCompletion('sys', 'user', { requireComplete: true })).rejects.toBe(error);
        });
    });
});
