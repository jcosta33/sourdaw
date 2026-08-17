import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateAnthropicToolCalls } from '../generateAnthropicToolCalls';

const requestProvider = vi.hoisted(() => vi.fn());

vi.mock('../requestAnthropicProvider', () => ({ requestAnthropicProvider: requestProvider }));

const runtime = {
    provider: 'anthropic' as const,
    model: 'claude-test',
    session_id: 'provider-session-00000000000000000000000000000000',
};
const toolSchemas = [
    {
        type: 'function' as const,
        function: {
            name: 'setTempo',
            description: 'Set tempo',
            parameters: {
                type: 'object' as const,
                properties: { bpm: { type: 'number' } },
                required: ['bpm'],
                additionalProperties: false,
            },
        },
    },
];

function returnPayload(payload: unknown, status = 200): void {
    requestProvider.mockImplementation(async ({ onBodyChunk }) => {
        onBodyChunk(new TextEncoder().encode(JSON.stringify(payload)));
        return { status, contentType: 'application/json' };
    });
}

describe('generateAnthropicToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps tool calls through an opaque native session', async () => {
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'tool_use',
        });

        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                signal: new AbortController().signal,
            })
        ).resolves.toEqual([{ id: 'tool-1', name: 'setTempo', arguments: { bpm: 120 } }]);
        expect(requestProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: runtime.session_id,
                body: expect.stringContaining('"setTempo"'),
            })
        );
    });

    it('accepts an explicit empty tool batch', async () => {
        returnPayload({ content: [], stop_reason: 'end_turn' });
        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'nothing',
                toolSchemas,
                signal: new AbortController().signal,
            })
        ).resolves.toEqual([]);
    });

    it('rejects prose and incomplete tool batches', async () => {
        returnPayload({ content: [{ type: 'text', text: 'No.' }], stop_reason: 'end_turn' });
        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('non-tool response');
    });

    it('reports only the provider status on failure', async () => {
        returnPayload({ private: 'provider detail' }, 401);
        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('status 401');
    });

    it('rejects a successful response with the wrong content type', async () => {
        requestProvider.mockResolvedValue({ status: 200, contentType: 'text/plain' });

        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('invalid tool-planning content type');
    });
});
