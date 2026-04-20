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

            expect(mocks.tauriInvoke).toHaveBeenCalledWith('generate_native_completion', {
                systemPrompt: 'system prompt',
                userMessage: 'hello',
                temperature: 0.1,
                maxTokens: 2048,
            });
            expect(result).toBe('Tauri response');
        });
    });

    describe('when running in browser (dev mode)', () => {
        beforeEach(() => {
            mocks.isTauri.mockReturnValue(false);
        });

        it('calls localhost llama-server API', async () => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Fetch response' } }]
                })
            });

            const result = await generateNativeCompletion('system prompt', 'hello');

            expect(mocks.fetch).toHaveBeenCalledWith('http://127.0.0.1:8847/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: 'system prompt' },
                        { role: 'user', content: 'hello' }
                    ],
                    temperature: 0.1,
                    max_tokens: 2048,
                    seed: 0
                })
            });
            expect(result).toBe('Fetch response');
        });

        it('throws an error if fetch fails', async () => {
            mocks.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error'
            });

            await expect(generateNativeCompletion('sys', 'user')).rejects.toThrow('llama-server error 500: Internal Server Error');
        });
    });
});
