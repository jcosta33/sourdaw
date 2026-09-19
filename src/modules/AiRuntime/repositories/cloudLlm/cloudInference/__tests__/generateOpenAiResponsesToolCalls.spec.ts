import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isHostedAiHttpStatusError } from '../../../../errors/HostedAiHttpStatusError';
import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { compileProviderAdapterInstallation, OPENAI_RESPONSES_ADAPTER_ID } from '../../../providerAdapterRegistry';
import { type OpenAiCloudRuntime } from '../../cloudSession';
import { generateOpenAiResponsesToolCalls } from '../generateOpenAiResponsesToolCalls';
import { AUTO_TOOL_CHOICE, type HostedToolChoiceDirective } from '../hostedToolPlan';

const mocks = vi.hoisted(() => ({ requestHostedOpenAiProvider: vi.fn() }));

vi.mock('../requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: mocks.requestHostedOpenAiProvider,
}));

const tools: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'project.query',
            description: 'Query the project',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'muteTrack',
            description: 'Mute a track',
            parameters: {
                type: 'object',
                properties: { trackId: { type: 'string' } },
                required: ['trackId'],
                additionalProperties: false,
            },
        },
    },
];

function createRuntime(model: string, reasoningEffort?: OpenAiCloudRuntime['reasoning_effort']): OpenAiCloudRuntime {
    const runtime = {
        provider: 'openai' as const,
        model,
        base_url: 'https://api.openai.com/v1',
        authentication: 'api-key' as const,
        adapter: compileProviderAdapterInstallation({
            adapterId: OPENAI_RESPONSES_ADAPTER_ID,
            providerId: 'openai',
            modelId: model,
            protocolFamily: 'openai-responses',
            origin: 'https://api.openai.com',
        }),
        session_id: `provider-session-${'0'.repeat(32)}`,
    };
    return reasoningEffort !== undefined ? { ...runtime, reasoning_effort: reasoningEffort } : runtime;
}

const runtime = createRuntime('gpt-4-turbo');

let sentBodies: string[] = [];

function respondWith(payload: unknown, status = 200): void {
    sentBodies = [];
    mocks.requestHostedOpenAiProvider.mockImplementation(
        async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
            sentBodies.push(request.body);
            const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
            request.onBodyChunk(new TextEncoder().encode(text));
            return { status, contentType: 'application/json' };
        }
    );
}

function planTools(
    targetRuntime: OpenAiCloudRuntime = runtime,
    directive: HostedToolChoiceDirective = AUTO_TOOL_CHOICE
) {
    return generateOpenAiResponsesToolCalls({
        runtime: targetRuntime,
        systemPrompt: 'system',
        userMessage: 'mute drums',
        toolSchemas: tools,
        maxOutputTokens: 8_192,
        directive,
    });
}

function readSentBody(): Record<string, unknown> {
    const sent = sentBodies[0];
    if (sent === undefined) {
        throw new Error('Expected a JSON request body');
    }
    return JSON.parse(sent) as Record<string, unknown>;
}

function functionCall(callId: string, wireName: string, arguments_: string): Record<string, unknown> {
    return { type: 'function_call', id: 'fc-shared', call_id: callId, name: wireName, arguments: arguments_ };
}

describe('generateOpenAiResponsesToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sends the responses tool-planning shape with wire-encoded tool names', async () => {
        respondWith({ id: 'resp_1', status: 'completed', output: [] });

        await planTools();

        expect(readSentBody()).toEqual({
            model: 'gpt-4-turbo',
            instructions: 'system',
            input: [{ role: 'user', content: 'mute drums' }],
            tools: [
                {
                    type: 'function',
                    name: 'project_query',
                    description: 'Query the project',
                    parameters: tools[0]?.function.parameters,
                    strict: true,
                },
                {
                    type: 'function',
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: tools[1]?.function.parameters,
                    strict: true,
                },
            ],
            tool_choice: 'auto',
            parallel_tool_calls: true,
            max_output_tokens: 8_192,
            stream: false,
            store: false,
        });
    });

    it('forces the allowed-tools set on a required directive while leaving the advertised tools list full, dropping a directive name with no advertised schema', async () => {
        respondWith({ id: 'resp_1', status: 'completed', output: [] });

        await planTools(runtime, { mode: 'required', toolNames: ['muteTrack', 'deleteEverything'] });

        const body = readSentBody();
        expect(body.tool_choice).toEqual({
            type: 'allowed_tools',
            mode: 'required',
            tools: [{ type: 'function', name: 'muteTrack' }],
        });
        // `allowed_tools` restricts the choice set without capping the call count, so
        // parallel tool calls stay enabled on the forced turn.
        expect(body.parallel_tool_calls).toBe(true);
        // The full advertised set stays on the wire; `allowed_tools` restricts the
        // model's choice without dropping the other tool from what it can see.
        expect(body.tools).toEqual([
            {
                type: 'function',
                name: 'project_query',
                description: 'Query the project',
                parameters: tools[0]?.function.parameters,
                strict: true,
            },
            {
                type: 'function',
                name: 'muteTrack',
                description: 'Mute a track',
                parameters: tools[1]?.function.parameters,
                strict: true,
            },
        ]);
    });

    it('throws before any network call when a required directive names no tool', async () => {
        await expect(planTools(runtime, { mode: 'required', toolNames: [] })).rejects.toThrow(
            'Hosted AI tool-choice directive named an empty tool set'
        );
        expect(mocks.requestHostedOpenAiProvider).not.toHaveBeenCalled();
    });

    it('defaults reasoning effort to none for the gpt-5.6 family when unconfigured', async () => {
        respondWith({ id: 'resp_1', status: 'completed', output: [] });

        await planTools(createRuntime('gpt-5.6-luna'));

        expect(readSentBody()).toMatchObject({ reasoning: { effort: 'none' } });
    });

    it('sends no reasoning extension for an unconfigured model outside the gpt-5.6 family', async () => {
        respondWith({ id: 'resp_1', status: 'completed', output: [] });

        await planTools(createRuntime('gpt-4-turbo'));

        expect(readSentBody()).not.toHaveProperty('reasoning');
    });

    it.each(['gpt-5.6-luna', 'gpt-4-turbo'])('sends the configured reasoning effort override for %s', async (model) => {
        respondWith({ id: 'resp_1', status: 'completed', output: [] });

        await planTools(createRuntime(model, 'high'));

        expect(readSentBody()).toMatchObject({ reasoning: { effort: 'high' } });
    });

    it('preserves call_id order across items the plan does not carry', async () => {
        respondWith({
            id: 'resp_1',
            status: 'completed',
            output: [
                functionCall('call_a', 'project_query', '{}'),
                { type: 'reasoning', summary: [] },
                { type: 'message', content: [{ type: 'output_text', text: '' }] },
                functionCall('call_b', 'muteTrack', '{"trackId":"track-1"}'),
            ],
        });

        await expect(planTools()).resolves.toEqual({
            providerRequestId: 'resp_1',
            calls: [
                { id: 'call_a', name: 'project.query', arguments: {} },
                { id: 'call_b', name: 'muteTrack', arguments: { trackId: 'track-1' } },
            ],
            strictToolSchemas: true,
            usage: null,
        });
    });

    it('rejects the whole batch when one call carries malformed arguments', async () => {
        respondWith({
            id: 'resp_1',
            status: 'completed',
            output: [
                functionCall('call_a', 'muteTrack', '{"trackId":"track-1"}'),
                functionCall('call_b', 'muteTrack', 'not-json'),
            ],
        });

        await expect(planTools()).rejects.toThrow('Hosted AI returned an invalid tool-call batch for call call_b');
    });

    it('rejects a refusal without exposing its text', async () => {
        respondWith({
            id: 'resp_1',
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refusal-body-text' }] }],
        });

        const error = await planTools().catch((error: unknown) => error);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Hosted AI refused tool planning');
    });

    it('attributes provider-reported usage to a refused turn', async () => {
        respondWith({
            id: 'resp_1',
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refusal-body-text' }] }],
            usage: { input_tokens: 22, output_tokens: 4, input_tokens_details: { cached_tokens: 0 } },
        });

        const error = await planTools().catch((error: unknown) => error);

        expect(error).toMatchObject({
            name: 'ToolPlanningRejectedError',
            usage: { inputTokens: 22, outputTokens: 4, cacheReadInputTokens: 0, cacheWriteInputTokens: null },
        });
    });

    it('rejects a prose answer that carries no tool call', async () => {
        respondWith({
            id: 'resp_1',
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'I muted the drums.' }] }],
        });

        await expect(planTools()).rejects.toThrow(
            'Hosted AI returned a non-tool response instead of a tool-call batch'
        );
    });

    it('rejects a plan the token limit truncated', async () => {
        respondWith({
            id: 'resp_1',
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [functionCall('call_a', 'muteTrack', '{"trackId":"track-1"}')],
        });

        await expect(planTools()).rejects.toThrow('Hosted AI tool plan was truncated at the token limit');
    });

    it('rejects a failed plan whose reason it cannot map', async () => {
        respondWith({
            id: 'resp_1',
            status: 'failed',
            incomplete_details: { reason: 'server_error' },
            output: [],
        });

        await expect(planTools()).rejects.toThrow('Hosted AI returned an incomplete tool-call batch');
    });

    it('terminally rejects malformed JSON syntax', async () => {
        respondWith('{');

        await expect(planTools()).rejects.toMatchObject({
            name: 'ToolPlanningRejectedError',
            message: 'Hosted AI returned an invalid tool-planning response',
        });
    });

    it('reports status without echoing the provider body', async () => {
        respondWith('key=sk-secret', 401);

        const error = await planTools().catch((error: unknown) => error);

        expect(isHostedAiHttpStatusError(error)).toBe(true);
        if (!isHostedAiHttpStatusError(error)) {
            return;
        }
        expect(error.message).toBe('Hosted AI tool request failed with status 401');
        expect(error.message).not.toContain('sk-secret');
    });

    it('reads provider-reported usage off the response and reports no cache-write figure', async () => {
        respondWith({
            id: 'resp_1',
            status: 'completed',
            output: [],
            usage: { input_tokens: 40, output_tokens: 7, input_tokens_details: { cached_tokens: 12 } },
        });

        const result = await planTools();

        expect(result.usage).toEqual({
            inputTokens: 40,
            outputTokens: 7,
            cacheReadInputTokens: 12,
            cacheWriteInputTokens: null,
        });
    });

    it('drops an unusable provider request id instead of reporting it', async () => {
        respondWith({ id: 'x'.repeat(5_000), status: 'completed', output: [] });

        await expect(planTools()).resolves.toEqual({
            providerRequestId: null,
            calls: [],
            strictToolSchemas: true,
            usage: null,
        });
    });
});
