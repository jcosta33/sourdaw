import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateWebLlmCompletion } from '../generateWebLlmCompletion';
import { generateWebLlmToolCalls } from '../toolCalling';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

vi.mock('../generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: vi.fn(),
}));

describe('generateWebLlmToolCalls', () => {
    beforeEach(() => {
        vi.mocked(generateWebLlmCompletion).mockReset();
        vi.clearAllMocks();
    });

    it('should return empty array when model returns empty text', async () => {
        vi.mocked(generateWebLlmCompletion).mockResolvedValue('');

        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const result = await generateWebLlmToolCalls('sys', 'user', tools);

        expect(result).toEqual([]);
    });

    it('should parse JSON tool calls from model response', async () => {
        vi.mocked(generateWebLlmCompletion).mockResolvedValue('[{"name":"addTrack","arguments":{"kind":"audio"}}]');

        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const result = await generateWebLlmToolCalls('sys', 'user', tools);

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('addTrack');
    });

    it('forwards cancellation to WebLLM completion', async () => {
        vi.mocked(generateWebLlmCompletion).mockResolvedValue('[]');
        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const controller = new AbortController();

        await generateWebLlmToolCalls('sys', 'user', tools, controller.signal);

        expect(vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[2]).toEqual({
            temperature: 0.1,
            signal: controller.signal,
        });
    });
});
