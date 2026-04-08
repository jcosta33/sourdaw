import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { generateWebLlmToolCalls } from './toolCalling';
import { type Logger } from '#/helpers/Logger/Logger';
import { initWebLlmEngine } from './engineLifecycle';

vi.mock('./engineLifecycle', () => ({
    initWebLlmEngine: vi.fn(),
}));

describe('generateWebLlmToolCalls', () => {
    beforeEach(() => {
        vi.mocked(initWebLlmEngine).mockReset();
    });

    it('should return empty array when model returns no tool calls or text', async () => {
        vi.mocked(initWebLlmEngine).mockResolvedValue({
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        choices: [{ message: { content: null, tool_calls: undefined } }],
                    }),
                },
            },
        } as never);

        const logger = createMock<Logger>();
        injectDependencies(generateWebLlmToolCalls, { logger });

        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const result = await generateWebLlmToolCalls('sys', 'user', tools);

        expect(result).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No tool calls'));
    });
});
