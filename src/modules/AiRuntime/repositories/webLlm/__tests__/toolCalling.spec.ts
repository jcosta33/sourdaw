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

    it.each([
        { response: '', label: 'empty', expectedReason: 'Model returned an empty tool-planning response.' },
        {
            response: 'I cannot change the project.',
            label: 'non-tool',
            expectedReason: 'Model returned a non-tool response instead of a complete tool-call batch.',
        },
        {
            response: '[{"name":"addTrack","arguments":{',
            label: 'malformed',
            expectedReason: 'Model returned a malformed tool-call batch.',
        },
        {
            response:
                '```json\n[{"name":"addTrack","arguments":{"kind":"audio"}}]\n```\n<tool_call>{"name":"muteTrack","arguments":{',
            label: 'trailing truncated',
            expectedReason: 'Model returned a malformed tool-call batch.',
        },
    ])('rejects a $label text planning response', async ({ response, expectedReason }) => {
        vi.mocked(generateWebLlmCompletion).mockResolvedValue(response);

        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const result = await generateWebLlmToolCalls('sys', 'user', tools);

        expect(result).toEqual({ status: 'rejected', reason: expectedReason });
    });

    it.each([
        { response: '[]', toolCalls: [] },
        {
            response: '[{"name":"addTrack","arguments":{"kind":"audio"}}]',
            toolCalls: [{ name: 'addTrack', arguments: { kind: 'audio' } }],
        },
    ])('parses a complete JSON tool-call response', async ({ response, toolCalls }) => {
        vi.mocked(generateWebLlmCompletion).mockResolvedValue(response);
        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const result = await generateWebLlmToolCalls('sys', 'user', tools);
        expect(result).toEqual({ status: 'complete', toolCalls, proposal: null });
    });

    it('forwards cancellation to WebLLM completion', async () => {
        vi.mocked(generateWebLlmCompletion).mockResolvedValue('[]');
        const tools = [{ type: 'function' as const, function: { name: 'addTrack', description: '', parameters: {} } }];
        const controller = new AbortController();

        await generateWebLlmToolCalls('sys', 'user', tools, controller.signal);

        expect(vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[2]).toEqual({
            temperature: 0.1,
            signal: controller.signal,
            requireComplete: true,
        });
    });
});
