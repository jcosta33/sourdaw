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

    it('returns a normally completed strict tool-planning answer', async () => {
        await expect(generateWebLlmCompletion('system', 'user', { requireComplete: true })).resolves.toBe(
            'Final answer'
        );
    });

    it('rejects a token-limited response before structured consumers can parse it', async () => {
        mocks.createCompletion.mockResolvedValue({
            choices: [{ finish_reason: 'length', message: { content: '[{"name":"muteTrack"}]' } }],
        });

        await expect(generateWebLlmCompletion('system', 'user')).rejects.toThrow(
            'WebLLM returned an incomplete completion'
        );
    });

    it.each([
        {
            label: 'length finish',
            response: {
                choices: [{ finish_reason: 'length', message: { content: '[{"name":"muteTrack"}]' } }],
            },
        },
        { label: 'missing choice', response: { choices: [] } },
        { label: 'missing finish', response: { choices: [{ message: { content: '[]' } }] } },
        { label: 'missing message', response: { choices: [{ finish_reason: 'stop' }] } },
        { label: 'non-string content', response: { choices: [{ finish_reason: 'stop', message: { content: null } }] } },
    ])('terminally rejects strict tool planning with $label', async ({ response }) => {
        mocks.createCompletion.mockResolvedValue(response);

        await expect(generateWebLlmCompletion('system', 'user', { requireComplete: true })).rejects.toMatchObject({
            name: 'ToolPlanningRejectedError',
        });
    });

    it('preserves WebLLM runtime errors during strict tool planning', async () => {
        const error = new TypeError('WebGPU device lost');
        mocks.createCompletion.mockRejectedValue(error);

        await expect(generateWebLlmCompletion('system', 'user', { requireComplete: true })).rejects.toBe(error);
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
        const pending = generateWebLlmCompletion('system', 'user', {
            signal: controller.signal,
            requireComplete: true,
        });
        await vi.waitFor(() => expect(mocks.createCompletion).toHaveBeenCalledTimes(1));

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.interruptGenerate).toHaveBeenCalledTimes(1);
    });
});
