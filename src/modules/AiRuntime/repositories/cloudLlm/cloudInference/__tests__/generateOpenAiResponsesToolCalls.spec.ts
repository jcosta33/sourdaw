import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isHostedAiHttpStatusError } from '../../../../errors/HostedAiHttpStatusError';
import { type ToolSchema } from '../../../../models/ToolDefinitions';
import { compileProviderAdapterInstallation, OPENAI_RESPONSES_ADAPTER_ID } from '../../../providerAdapterRegistry';
import { type OpenAiCloudRuntime } from '../../cloudSession';
import { generateOpenAiResponsesToolCalls } from '../generateOpenAiResponsesToolCalls';

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

function createRuntime(model: string): OpenAiCloudRuntime {
    return {
        provider: 'openai',
        model,
        base_url: 'https://api.openai.com/v1',
        authentication: 'api-key',
        adapter: compileProviderAdapterInstallation({
            adapterId: OPENAI_RESPONSES_ADAPTER_ID,
            providerId: 'openai',
            modelId: model,
            protocolFamily: 'openai-responses',
            origin: 'https://api.openai.com',
        }),
        session_id: `provider-session-${'0'.repeat(32)}`,
    };
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

function planTools(targetRuntime: OpenAiCloudRuntime = runtime) {
    return generateOpenAiResponsesToolCalls({
        runtime: targetRuntime,
        systemPrompt: 'system',
        userMessage: 'mute drums',
        toolSchemas: tools,
        maxOutputTokens: 8_192,
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
                    strict: false,
                },
                {
                    type: 'function',
                    name: 'muteTrack',
                    description: 'Mute a track',
                    parameters: tools[1]?.function.parameters,
                    strict: false,
                },
            ],
            tool_choice: 'auto',
            parallel_tool_calls: true,
            max_output_tokens: 8_192,
            stream: false,
            store: false,
        });
    });

    it.each(['gpt-5.6-luna', 'gpt-4-turbo'])('gates reasoning effort on the gpt-5.6 family (%s)', async (model) => {
        respondWith({ id: 'resp_1', status: 'completed', output: [] });

        await planTools(createRuntime(model));

        const body = readSentBody();
        if (model === 'gpt-5.6-luna') {
            expect(body).toMatchObject({ reasoning: { effort: 'none' } });
        } else {
            expect(body).not.toHaveProperty('reasoning');
        }
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

    it('drops an unusable provider request id instead of reporting it', async () => {
        respondWith({ id: 'x'.repeat(5_000), status: 'completed', output: [] });

        await expect(planTools()).resolves.toEqual({ providerRequestId: null, calls: [] });
    });
});
