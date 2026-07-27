import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateWebLlmCompletion } from '../generateWebLlmCompletion';

const mocks = vi.hoisted(() => ({
    createCompletion: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
    interruptGenerate: vi.fn(),
    initWebLlmEngine: vi.fn(),
    info: vi.fn(),
}));

vi.mock('../initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function ignoreRejection(_reason: unknown): void {}

describe('generateWebLlmCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.initWebLlmEngine.mockResolvedValue({
            interruptGenerate: mocks.interruptGenerate,
            chat: { completions: { create: mocks.createCompletion } },
        });
        mocks.createCompletion.mockResolvedValue({
            choices: [{ finish_reason: 'stop', message: { content: '<think>reasoning</think>Final answer' } }],
        });
    });

    it('returns only a normally completed answer', async () => {
        await expect(generateWebLlmCompletion('system', 'user')).resolves.toBe('Final answer');
    });

    it('rejects a token-limited response before structured consumers can parse it', async () => {
        mocks.createCompletion.mockResolvedValue({
            choices: [{ finish_reason: 'length', message: { content: '[{"name":"muteTrack"}]' } }],
        });

        await expect(generateWebLlmCompletion('system', 'user')).rejects.toThrow(
            'WebLLM returned an incomplete completion'
        );
    });

    it('interrupts active inference when the caller aborts', async () => {
        let rejectCompletion: (reason: unknown) => void = ignoreRejection;
        mocks.createCompletion.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    rejectCompletion = reject;
                })
        );
        mocks.interruptGenerate.mockImplementation(() => {
            rejectCompletion(new DOMException('Aborted', 'AbortError'));
        });
        const controller = new AbortController();
        const pending = generateWebLlmCompletion('system', 'user', { signal: controller.signal });
        await vi.waitFor(() => expect(mocks.createCompletion).toHaveBeenCalledTimes(1));

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.interruptGenerate).toHaveBeenCalledTimes(1);
    });
});
