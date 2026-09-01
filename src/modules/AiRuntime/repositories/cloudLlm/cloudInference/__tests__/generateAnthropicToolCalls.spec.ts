import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateAnthropicToolCalls } from '../generateAnthropicToolCalls';

const requestProvider = vi.hoisted(() => vi.fn());

vi.mock('../requestAnthropicProvider', () => ({ requestAnthropicProvider: requestProvider }));

const runtime = {
    provider: 'anthropic' as const,
    authentication: 'api-key' as const,
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

    it('encodes dotted tool names on the wire and decodes them on the response', async () => {
        const dottedSchemas = [
            {
                type: 'function' as const,
                function: {
                    name: 'project.query',
                    description: 'Query the project',
                    parameters: {
                        type: 'object' as const,
                        properties: {},
                        required: [],
                        additionalProperties: false,
                    },
                },
            },
        ];
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'project_query', input: {} }],
            stop_reason: 'tool_use',
        });

        const result = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'what tracks exist',
            toolSchemas: dottedSchemas,
            signal: new AbortController().signal,
        });

        expect(result).toEqual([{ id: 'tool-1', name: 'project.query', arguments: {} }]);
        const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as { tools: Array<{ name: string }> };
        expect(body.tools[0]?.name).toBe('project_query');
        for (const tool of body.tools) {
            expect(tool.name).not.toContain('.');
        }
    });
});
