import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isHostedAiHttpStatusError } from '../../../../errors/HostedAiHttpStatusError';
import {
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
} from '../../../../models/AgentToolCatalogNames';
import { type ToolSchema } from '../../../../models/Tools/Types';
import { APPLICATION_OWNED_TOOL_SCHEMAS } from '../../../../useCases/applicationOwnedToolLoop';
import { getPlanningProviderToolSchemas } from '../../../../useCases/getPlanningProviderToolSchemas';
import { encodeWireToolName } from '../encodeWireToolName';
import { generateAnthropicToolCalls } from '../generateAnthropicToolCalls';
import { AUTO_TOOL_CHOICE } from '../hostedToolPlan';

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
                directive: AUTO_TOOL_CHOICE,
                signal: new AbortController().signal,
            })
        ).resolves.toMatchObject({ calls: [{ id: 'tool-1', name: 'setTempo', arguments: { bpm: 120 } }] });
        expect(requestProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: runtime.session_id,
                body: expect.stringContaining('"setTempo"'),
            })
        );
    });

    it('narrows the wire tools and forces tool_choice on a required directive', async () => {
        const twoTools = [
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
        ];
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'tool_use',
        });

        await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas: twoTools,
            maxOutputTokens: 8192,
            directive: { mode: 'required', toolNames: ['setTempo'] },
            signal: new AbortController().signal,
        });

        const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!request) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(request.body) as {
            tool_choice: unknown;
            tools: Array<{ name: string; cache_control?: { type: string } }>;
        };
        expect(body.tool_choice).toEqual({ type: 'any' });
        expect(body.tools).toHaveLength(1);
        expect(body.tools[0]?.name).toBe('setTempo');
        expect(body.tools[0]?.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('narrows to exactly the directive-named tools, in their advertised order, dropping an unnamed one', async () => {
        const threeTools = [
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
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setVolume', input: { db: -3 } }],
            stop_reason: 'tool_use',
        });

        await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'quieter and centered',
            toolSchemas: threeTools,
            maxOutputTokens: 8192,
            directive: { mode: 'required', toolNames: ['setVolume', 'setPan'] },
            signal: new AbortController().signal,
        });

        const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!request) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(request.body) as { tools: Array<{ name: string }> };
        expect(body.tools.map((tool) => tool.name)).toEqual(['setVolume', 'setPan']);
    });

    it('throws before any network call when a required directive names no tool', async () => {
        await expect(
            generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'faster',
                toolSchemas,
                maxOutputTokens: 8192,
                directive: { mode: 'required', toolNames: ['doesNotExist'] },
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI tool-choice directive named an empty tool set');
        expect(requestProvider).not.toHaveBeenCalled();
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
            directive: AUTO_TOOL_CHOICE,
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
            directive: AUTO_TOOL_CHOICE,
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
                directive: AUTO_TOOL_CHOICE,
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
                directive: AUTO_TOOL_CHOICE,
                signal: new AbortController().signal,
            })
        ).resolves.toMatchObject({ calls: [] });
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
                directive: AUTO_TOOL_CHOICE,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('non-tool response');
    });

    it('attributes provider-reported usage to a rejected non-tool reply', async () => {
        returnPayload({
            content: [{ type: 'text', text: 'I cannot do that.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 30, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        });

        const error = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
            signal: new AbortController().signal,
        }).catch((error: unknown) => error);

        expect(error).toMatchObject({
            name: 'ToolPlanningRejectedError',
            usage: { inputTokens: 30, outputTokens: 12, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
        });
    });

    it('reports only the provider status on failure', async () => {
        returnPayload({ private: 'provider detail' }, 401);
        const error = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
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
                directive: AUTO_TOOL_CHOICE,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('invalid tool-planning content type');
    });

    it('sends a strict, bound-free wire schema and reads provider-reported usage', async () => {
        const boundedSchemas = [
            {
                type: 'function' as const,
                function: {
                    name: 'setTempo',
                    description: 'Set tempo',
                    parameters: {
                        type: 'object' as const,
                        properties: { bpm: { type: 'number', minimum: 20, maximum: 300 } },
                        required: ['bpm'],
                        additionalProperties: false,
                    },
                },
            },
        ];
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 50, output_tokens: 9, cache_read_input_tokens: 5, cache_creation_input_tokens: 8 },
        });

        const result = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas: boundedSchemas,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
            signal: new AbortController().signal,
        });

        const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!request) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(request.body) as {
            tools: Array<{ strict?: boolean; input_schema: Record<string, unknown> }>;
        };
        expect(body.tools[0]?.strict).toBe(true);
        expect(body.tools[0]?.input_schema).not.toHaveProperty(['properties', 'bpm', 'minimum']);
        expect(result.strictToolSchemas).toBe(true);
        expect(result.usage).toEqual({
            inputTokens: 63,
            outputTokens: 9,
            cacheReadInputTokens: 5,
            cacheWriteInputTokens: 8,
            reasoningTokens: null,
        });
    });

    it.each([
        {
            name: 'an overflowing input total',
            usage: {
                input_tokens: Number.MAX_SAFE_INTEGER,
                output_tokens: 1,
                cache_read_input_tokens: 1,
                cache_creation_input_tokens: 0,
            },
            cacheReadInputTokens: 1,
            cacheWriteInputTokens: 0,
        },
        {
            name: 'a malformed cache counter',
            usage: {
                input_tokens: 10,
                output_tokens: 1,
                cache_read_input_tokens: -1,
                cache_creation_input_tokens: 2,
            },
            cacheReadInputTokens: null,
            cacheWriteInputTokens: 2,
        },
        {
            name: 'a missing raw input counter',
            usage: {
                output_tokens: 1,
                cache_read_input_tokens: 5,
                cache_creation_input_tokens: 8,
            },
            cacheReadInputTokens: 5,
            cacheWriteInputTokens: 8,
        },
    ])('refuses to undercount $name', async ({ usage, cacheReadInputTokens, cacheWriteInputTokens }) => {
        returnPayload({
            content: [{ type: 'tool_use', id: 'tool-1', name: 'setTempo', input: { bpm: 120 } }],
            stop_reason: 'tool_use',
            usage,
        });

        const result = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'faster',
            toolSchemas,
            maxOutputTokens: 8192,
            directive: AUTO_TOOL_CHOICE,
            signal: new AbortController().signal,
        });

        expect(result.usage).toMatchObject({
            inputTokens: null,
            outputTokens: 1,
            cacheReadInputTokens,
            cacheWriteInputTokens,
        });
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
            directive: AUTO_TOOL_CHOICE,
            signal: new AbortController().signal,
        });

        expect(result.calls).toEqual([{ id: 'tool-1', name: 'project.query', arguments: {} }]);
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

    describe('production-catalog strict-tool admission', () => {
        type WireTool = { name: string; strict?: boolean; input_schema: Record<string, unknown> };

        function isRecord(value: unknown): value is Record<string, unknown> {
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        }

        /**
         * Independently recounts the two per-parameter budgets straight off the captured
         * wire `input_schema` — a fresh walk written in this spec, never a call into
         * `selectAnthropicStrictTools`'s own counter, so the assertion below cannot pass
         * merely because production and test share one (possibly wrong) implementation.
         */
        function countWireSchemaComplexity(node: unknown): { optionalParameters: number; unionParameters: number } {
            if (!isRecord(node)) {
                return { optionalParameters: 0, unionParameters: 0 };
            }
            let optionalParameters = 0;
            let unionParameters = Array.isArray(node.anyOf) || Array.isArray(node.type) ? 1 : 0;
            if (isRecord(node.properties)) {
                const required = new Set(Array.isArray(node.required) ? node.required : []);
                for (const [propertyName, propertySchema] of Object.entries(node.properties)) {
                    if (!required.has(propertyName)) {
                        optionalParameters += 1;
                    }
                    const nested = countWireSchemaComplexity(propertySchema);
                    optionalParameters += nested.optionalParameters;
                    unionParameters += nested.unionParameters;
                }
            }
            if (node.items !== undefined) {
                const nested = countWireSchemaComplexity(node.items);
                optionalParameters += nested.optionalParameters;
                unionParameters += nested.unionParameters;
            }
            for (const branchKey of ['anyOf', 'allOf'] as const) {
                const branches = node[branchKey];
                if (!Array.isArray(branches)) {
                    continue;
                }
                for (const branch of branches) {
                    const nested = countWireSchemaComplexity(branch);
                    optionalParameters += nested.optionalParameters;
                    unionParameters += nested.unionParameters;
                }
            }
            return { optionalParameters, unionParameters };
        }

        async function captureRequestBody(toolSchemas: readonly ToolSchema[]): Promise<{ tools: WireTool[] }> {
            returnPayload({ content: [], stop_reason: 'end_turn' });
            await generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'turn the drums down 2 dB',
                toolSchemas,
                maxOutputTokens: 8192,
                directive: AUTO_TOOL_CHOICE,
                signal: new AbortController().signal,
            });
            const request = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
            if (!request) {
                throw new Error('Expected a recorded provider request');
            }
            return JSON.parse(request.body) as { tools: WireTool[] };
        }

        it.each([
            ['getPlanningProviderToolSchemas()', getPlanningProviderToolSchemas()],
            ['APPLICATION_OWNED_TOOL_SCHEMAS', APPLICATION_OWNED_TOOL_SCHEMAS],
        ])('keeps the strict subset of %s within the documented complexity caps', async (_label, toolSchemas) => {
            const body = await captureRequestBody(toolSchemas);
            const strictTools = body.tools.filter((wireTool) => wireTool.strict === true);

            // Literal caps, not the production constants: this proves the wire request
            // this repository actually sends stays inside Anthropic's documented limits,
            // not merely that the selector agrees with itself.
            expect(strictTools.length).toBeLessThanOrEqual(20);

            let totalOptionalParameters = 0;
            let totalUnionParameters = 0;
            for (const wireTool of strictTools) {
                const complexity = countWireSchemaComplexity(wireTool.input_schema);
                totalOptionalParameters += complexity.optionalParameters;
                totalUnionParameters += complexity.unionParameters;
            }
            expect(totalOptionalParameters).toBeLessThanOrEqual(24);
            expect(totalUnionParameters).toBeLessThanOrEqual(16);

            const proposeWireName = encodeWireToolName(COMMAND_BATCH_PROPOSAL_TOOL_NAME);
            const declineWireName = encodeWireToolName(COMMAND_BATCH_DECLINE_TOOL_NAME);
            const proposeTool = body.tools.find((wireTool) => wireTool.name === proposeWireName);
            const declineTool = body.tools.find((wireTool) => wireTool.name === declineWireName);
            expect(proposeTool).toBeDefined();
            expect(declineTool).toBeDefined();
            // `command.batch.propose` alone carries 36 optional parameters — more than the
            // whole request's 24-parameter budget — so it must be sent non-strict.
            expect(proposeTool?.strict).toBeUndefined();
            expect(declineTool?.strict).toBe(true);
        });
    });
});
