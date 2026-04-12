import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWebLlmToolCalls } from '../toolCalling';
import { initWebLlmEngine } from '../engineLifecycle';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

vi.mock('../engineLifecycle', () => ({
    initWebLlmEngine: vi.fn(),
}));

describe('generateWebLlmToolCalls', () => {
    beforeEach(() => {
        vi.mocked(initWebLlmEngine).mockReset();
        vi.clearAllMocks();
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

        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const result = await generateWebLlmToolCalls('sys', 'user', tools);

        expect(result).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No tool calls'));
    });
});
