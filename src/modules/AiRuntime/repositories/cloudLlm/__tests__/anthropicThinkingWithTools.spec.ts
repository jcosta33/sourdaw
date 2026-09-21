import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApplicationToolReceipt } from '../../../models/ApplicationOwnedTool';
import { type HostedAnthropicThinking } from '../../../models/HostedLlmProvider';
import { type HostedTurnHistory } from '../../../models/HostedTurnHistory';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { generateAnthropicToolCalls } from '../cloudInference/generateAnthropicToolCalls';
import { AUTO_TOOL_CHOICE, type HostedToolChoiceDirective } from '../cloudInference/hostedToolPlan';
import { type AnthropicCloudRuntime } from '../cloudSession';

const mocks = vi.hoisted(() => ({ runProviderGatewayRequest: vi.fn() }));

vi.mock('../../providerGateway', () => ({
    runProviderGatewayRequest: mocks.runProviderGatewayRequest,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SESSION_ID = `provider-session-${'0'.repeat(32)}`;
const MAX_OUTPUT_TOKENS = 8_192;
const USER_MESSAGE = 'inspect the project, then set the tempo';
const BUDGET_NOTE = 'Remaining budget: 2 turn(s), 6 tool call(s), 40000 receipt byte(s).';

function runtimeFor(input: { model?: string; thinking?: HostedAnthropicThinking }): AnthropicCloudRuntime {
    const base = {
        provider: 'anthropic' as const,
        authentication: 'api-key' as const,
        model: input.model ?? 'claude-sonnet-5',
        session_id: SESSION_ID,
    };
    return input.thinking === undefined ? base : { ...base, thinking: input.thinking };
}

const toolSchemas: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'project.query',
            description: 'Read the current project',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'setTempo',
            description: 'Set tempo',
            parameters: {
                type: 'object',
                properties: { bpm: { type: 'number' } },
                required: ['bpm'],
                additionalProperties: false,
            },
        },
    },
];

/** The blocks a thinking model puts ahead of the call it produced; both must survive a replay. */
const THINKING_BLOCK = {
    type: 'thinking',
    thinking: 'The project has to be read before the tempo changes.',
    signature: 'signature-bytes',
};
const REDACTED_THINKING_BLOCK = { type: 'redacted_thinking', data: 'redacted-bytes' };
const TOOL_USE_BLOCK = { type: 'tool_use', id: 'toolu_query_1', name: 'project_query', input: {} };

const THINKING_TURN_RESPONSE = {
    id: 'msg_1',
    content: [THINKING_BLOCK, REDACTED_THINKING_BLOCK, TOOL_USE_BLOCK],
    stop_reason: 'tool_use',
};

const SECOND_TURN_RESPONSE = {
    id: 'msg_2',
    content: [{ type: 'tool_use', id: 'toolu_tempo_1', name: 'setTempo', input: { bpm: 128 } }],
    stop_reason: 'tool_use',
};

const RECEIPT: ApplicationToolReceipt = {
    schema: 'sourdaw.application-tool-receipt',
    schemaVersion: 1,
    callId: TOOL_USE_BLOCK.id,
    toolName: 'project.query',
    turn: 1,
    status: 'success',
    revision: 'revision-2',
    data: { items: [] },
    summary: 'Queried the project.',
    warnings: [],
    error: null,
};

let sentRequestBodies: string[] = [];

function respondWith(payload: Record<string, unknown>): void {
    mocks.runProviderGatewayRequest.mockImplementationOnce(
        async (request: {
            body: string | null;
            onResponseStart: (value: { status: number; contentType: string | null }) => void;
            onBodyChunk: (chunk: Uint8Array) => void;
        }) => {
            sentRequestBodies.push(request.body ?? '');
            request.onResponseStart({ status: 200, contentType: 'application/json' });
            request.onBodyChunk(new TextEncoder().encode(JSON.stringify(payload)));
        }
    );
}

function readBody(index: number): Record<string, unknown> {
    const sent = sentRequestBodies[index];
    if (sent === undefined || sent.length === 0) {
        throw new Error('Expected the adapter to send a JSON request body');
    }
    return JSON.parse(sent) as Record<string, unknown>;
}

function planTurn(input: {
    runtime: AnthropicCloudRuntime;
    directive?: HostedToolChoiceDirective;
    history?: HostedTurnHistory;
}): ReturnType<typeof generateAnthropicToolCalls> {
    const planInput: Parameters<typeof generateAnthropicToolCalls>[0] = {
        runtime: input.runtime,
        systemPrompt: 'system',
        userMessage: USER_MESSAGE,
        toolSchemas,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        directive: input.directive ?? AUTO_TOOL_CHOICE,
        signal: new AbortController().signal,
    };
    if (input.history !== undefined) {
        planInput.history = input.history;
        planInput.budgetNote = BUDGET_NOTE;
    }
    return generateAnthropicToolCalls(planInput);
}

beforeEach(() => {
    sentRequestBodies = [];
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('Anthropic extended thinking on the tool-planning request', () => {
    it('sends no thinking object when the profile configures none', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({ runtime: runtimeFor({}) });

        const body = readBody(0);
        expect('thinking' in body).toBe(false);
        expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    });

    it('asks for adaptive thinking whose output the planning turn never reads', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({ runtime: runtimeFor({ thinking: { type: 'adaptive' } }) });

        const body = readBody(0);
        expect(body.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
        expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    });

    it('adds a fixed thinking budget on top of the admitted output budget', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({ runtime: runtimeFor({ thinking: { type: 'enabled', budgetTokens: 2048 } }) });

        const body = readBody(0);
        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
        expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS + 2048);
    });
});

describe('Anthropic thinking blocks in a tool-planning reply', () => {
    it('reads the tool call past its thinking blocks and records them verbatim', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        const plan = await planTurn({ runtime: runtimeFor({ thinking: { type: 'adaptive' } }) });

        expect(plan.calls).toEqual([{ id: TOOL_USE_BLOCK.id, name: 'project.query', arguments: {} }]);
        expect(plan.assistantItems).toEqual(THINKING_TURN_RESPONSE.content);
    });

    it('accepts a turn that thought and called nothing as an empty batch', async () => {
        respondWith({ id: 'msg_1', content: [THINKING_BLOCK], stop_reason: 'end_turn' });

        const plan = await planTurn({ runtime: runtimeFor({ thinking: { type: 'adaptive' } }) });

        expect(plan.calls).toEqual([]);
    });

    it('replays the recorded thinking blocks ahead of the call, then the tool result', async () => {
        respondWith(THINKING_TURN_RESPONSE);
        respondWith(SECOND_TURN_RESPONSE);

        const runtime = runtimeFor({ thinking: { type: 'adaptive' } });
        const firstTurn = await planTurn({ runtime });
        await planTurn({
            runtime,
            history: [
                {
                    turn: 1,
                    provider: 'anthropic',
                    assistantItems: firstTurn.assistantItems,
                    calls: firstTurn.calls.map((call) => ({
                        id: call.id ?? RECEIPT.callId,
                        name: call.name,
                        arguments: call.arguments,
                    })),
                    receipts: [RECEIPT],
                },
            ],
        });

        const messages = readBody(1).messages as Array<{ role: string; content: unknown }>;
        expect(messages[1]).toEqual({
            role: 'assistant',
            content: [THINKING_BLOCK, REDACTED_THINKING_BLOCK, TOOL_USE_BLOCK],
        });
        expect(messages[2]).toEqual({
            role: 'user',
            content: [
                { type: 'tool_result', tool_use_id: RECEIPT.callId, content: JSON.stringify(RECEIPT) },
                { type: 'text', text: BUDGET_NOTE },
            ],
        });
    });
});

describe('Anthropic forced tool choice under extended thinking', () => {
    const forced: HostedToolChoiceDirective = { mode: 'required', toolNames: ['project.query'] };

    it('forces the tool choice on a model that accepts it', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({ runtime: runtimeFor({ thinking: { type: 'adaptive' } }), directive: forced });

        expect(readBody(0).tool_choice).toEqual({ type: 'any' });
    });

    it('omits the tool choice when a fixed thinking budget is enabled', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({
            runtime: runtimeFor({ thinking: { type: 'enabled', budgetTokens: 2048 } }),
            directive: forced,
        });

        expect('tool_choice' in readBody(0)).toBe(false);
    });

    it('omits the tool choice for a fable model even without thinking', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({ runtime: runtimeFor({ model: 'claude-fable-5-1' }), directive: forced });

        expect('tool_choice' in readBody(0)).toBe(false);
    });

    it('omits the tool choice for a dated mythos model', async () => {
        respondWith(THINKING_TURN_RESPONSE);

        await planTurn({ runtime: runtimeFor({ model: 'claude-mythos-5-1-20260901' }), directive: forced });

        expect('tool_choice' in readBody(0)).toBe(false);
    });
});

describe('Anthropic thinking token usage', () => {
    it('reports the provider-billed thinking tokens as reasoning tokens', async () => {
        respondWith({
            ...THINKING_TURN_RESPONSE,
            usage: { input_tokens: 30, output_tokens: 120, output_tokens_details: { thinking_tokens: 37 } },
        });

        const plan = await planTurn({ runtime: runtimeFor({ thinking: { type: 'adaptive' } }) });

        expect(plan.usage).toEqual({
            inputTokens: 30,
            outputTokens: 120,
            cacheReadInputTokens: null,
            cacheWriteInputTokens: null,
            reasoningTokens: 37,
        });
    });

    it('reports no reasoning tokens when the reply carries no thinking detail', async () => {
        respondWith({ ...THINKING_TURN_RESPONSE, usage: { input_tokens: 30, output_tokens: 120 } });

        const plan = await planTurn({ runtime: runtimeFor({ thinking: { type: 'adaptive' } }) });

        expect(plan.usage).toMatchObject({ reasoningTokens: null });
    });
});
