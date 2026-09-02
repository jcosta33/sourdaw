import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isHostedAiHttpStatusError } from '../../../../errors/HostedAiHttpStatusError';
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
                maxOutputTokens: 8192,
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

    it('marks the system prompt and only the last tool as cacheable', async () => {
        // Three tools, not two: with only two, `index !== 0` and `index === lastToolIndex`
        // agree on every index, so a regression that cache-marks "every tool but the
        // first" instead of "every tool but the last" would still pass. A middle tool
        // (index 1 of 3) disambiguates the two rules.
        const multiToolSchemas = [
            toolSchemas[0]!,
            {
                type: 'function' as const,
                function: {
                    name: 'setVolume',
                    description: 'Set volume',
                    parameters: {
                        type: 'object' as const,
                        properties: { db: { type: 'number' } },
                        required: ['db'],
                        additionalProperties: false,
                    },
                },
            },
            {
                type: 'function' as const,
                function: {
                    name: 'setPan',
                    description: 'Set pan',
                    parameters: {
                        type: 'object' as const,
                        properties: { pan: { type: 'number' } },
                        required: ['pan'],
                        additionalProperties: false,
                    },
                },
            },
        ];
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'tool_use',
        });

        await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas: multiToolSchemas,
            maxOutputTokens: 8192,
            signal: new AbortController().signal,
        });

        const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!request) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(request.body) as {
            max_tokens: number;
            system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
            tools: Array<{ name: string; cache_control?: { type: string } }>;
        };
        expect(body.max_tokens).toBe(8192);
        expect(body.system).toEqual([{ type: 'text', text: 'system', cache_control: { type: 'ephemeral' } }]);
        expect(body.tools).toHaveLength(3);
        for (const tool of body.tools.slice(0, -1)) {
            expect(tool.cache_control).toBeUndefined();
        }
        expect(body.tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('sends the caller-provided max_tokens on the wire rather than an internal constant', async () => {
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'tool_use',
        });

        await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas,
            maxOutputTokens: 4096,
            signal: new AbortController().signal,
        });

        const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!request) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(request.body) as { max_tokens: number };
        expect(body.max_tokens).toBe(4096);
    });

    it('rejects a tool plan truncated at the token limit instead of returning it partial', async () => {
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'max_tokens',
        });

        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                maxOutputTokens: 8192,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI tool plan was truncated at the token limit');
    });

    it('accepts an explicit empty tool batch', async () => {
        returnPayload({ content: [], stop_reason: 'end_turn' });
        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'nothing',
                toolSchemas,
                maxOutputTokens: 8192,
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
                maxOutputTokens: 8192,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('non-tool response');
    });

    it('reports only the provider status on failure', async () => {
        returnPayload({ private: 'provider detail' }, 401);
        const error = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas,
            maxOutputTokens: 8192,
            signal: new AbortController().signal,
        }).catch((error: unknown) => error);

        expect(isHostedAiHttpStatusError(error)).toBe(true);
        if (!isHostedAiHttpStatusError(error)) {
            return;
        }
        expect(error.message).toContain('status 401');
        expect(error.status).toBe(401);
        expect(error.message).not.toContain('provider detail');
        expect(error.message).not.toContain('private');
    });

    it('rejects a successful response with the wrong content type', async () => {
        requestProvider.mockResolvedValue({ status: 200, contentType: 'text/plain' });

        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                maxOutputTokens: 8192,
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
            maxOutputTokens: 8192,
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
