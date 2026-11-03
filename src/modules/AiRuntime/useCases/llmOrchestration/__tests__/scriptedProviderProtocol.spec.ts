import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateAnthropicToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateAnthropicToolCalls';
import { generateOpenAiCompatibleToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { APPLICATION_OWNED_TOOL_SCHEMAS, runApplicationOwnedToolLoop } from '../../applicationOwnedToolLoop';

type MockTransportInput = {
    body: string;
    onBodyChunk: (chunk: Uint8Array) => void;
};

type MockOpenAiTransportInput = MockTransportInput & {
    runtime: unknown;
    signal: AbortSignal;
};

type ProviderCall = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
};

const transportMocks = vi.hoisted(() => ({
    anthropic: vi.fn(),
    openAiCompatible: vi.fn(),
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: transportMocks.anthropic,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: transportMocks.openAiCompatible,
}));

const PROVIDER_CALLS: readonly ProviderCall[] = [
    {
        id: 'scripted-search',
        name: 'agent.command-index.search',
        arguments: { intent: 'mute track' },
    },
    {
        id: 'scripted-discovery',
        name: 'agent.catalog.discover',
        arguments: { category: 'command', names: ['muteTrack'] },
    },
    {
        id: 'scripted-proposal',
        name: 'command.batch.propose',
        arguments: { commands: [{ name: 'muteTrack', arguments: { trackId: 'track-1' } }] },
    },
];

const OMIT_DISCOVERY_CALLS = [
    PROVIDER_CALLS[0]!,
    {
        id: 'scripted-premature-proposal',
        name: 'command.batch.propose',
        arguments: { commands: [{ name: 'muteTrack', arguments: { trackId: 'track-1' } }] },
    },
] as const;

const ANTHROPIC_RUNTIME: Parameters<typeof generateAnthropicToolCalls>[0]['runtime'] = {
    provider: 'anthropic',
    authentication: 'api-key',
    session_id: 'scripted-session',
    model: 'scripted-model',
};

const OPENAI_COMPATIBLE_RUNTIME: Parameters<typeof generateOpenAiCompatibleToolCalls>[0]['runtime'] = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: 'scripted-model',
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: true,
};

function asAnthropicCall(call: ProviderCall): Record<string, unknown> {
    return {
        type: 'tool_use',
        id: call.id,
        name: call.name.replaceAll('.', '_'),
        input: call.arguments,
    };
}

function asOpenAiCall(call: ProviderCall): Record<string, unknown> {
    return {
        id: call.id,
        type: 'function',
        function: {
            name: call.name.replaceAll('.', '_'),
            arguments: JSON.stringify(call.arguments),
        },
    };
}

function anthropicResponse(call: ProviderCall, turn: number): Record<string, unknown> {
    return {
        id: `message-${String(turn)}`,
        type: 'message',
        role: 'assistant',
        content: [asAnthropicCall(call)],
        model: 'scripted-model',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
    };
}

function openAiResponse(call: ProviderCall, turn: number): Record<string, unknown> {
    return {
        id: `chatcmpl-${String(turn)}`,
        object: 'chat.completion',
        model: 'scripted-model',
        choices: [
            {
                index: 0,
                finish_reason: 'tool_calls',
                message: { role: 'assistant', content: null, tool_calls: [asOpenAiCall(call)] },
            },
        ],
    };
}

function installResponses(
    transport: 'anthropic' | 'openai-compatible',
    responses: readonly Record<string, unknown>[]
): Record<string, unknown>[] {
    const requests: Record<string, unknown>[] = [];
    const transportMock = transport === 'anthropic' ? transportMocks.anthropic : transportMocks.openAiCompatible;
    let responseIndex = 0;
    transportMock.mockImplementation(async (input: MockTransportInput | MockOpenAiTransportInput) => {
        requests.push(JSON.parse(input.body) as Record<string, unknown>);
        const response = responses[responseIndex];
        responseIndex += 1;
        if (response === undefined) {
            throw new Error('Scripted provider response fixture was exhausted.');
        }
        input.onBodyChunk(new TextEncoder().encode(JSON.stringify(response)));
        return { status: 200, contentType: 'application/json' };
    });
    return requests;
}

async function runScriptedLoop(input: { transport: 'anthropic' | 'openai-compatible' }) {
    const controller = new AbortController();
    return runApplicationOwnedToolLoop({
        loopId: `scripted-${input.transport}`,
        terminalToolNames: new Set(['command.batch.propose']),
        requestTurn: async ({ history, budgetNote, directive }) => {
            const common = {
                systemPrompt: 'Plan only through application-owned tools.',
                userMessage: 'Mute the named track.',
                toolSchemas: APPLICATION_OWNED_TOOL_SCHEMAS,
                maxOutputTokens: 128,
                directive,
                history,
                budgetNote,
                signal: controller.signal,
            };
            let plan;
            if (input.transport === 'anthropic') {
                plan = await generateAnthropicToolCalls({ ...common, runtime: ANTHROPIC_RUNTIME });
            } else {
                plan = await generateOpenAiCompatibleToolCalls({ ...common, runtime: OPENAI_COMPATIBLE_RUNTIME });
            }
            return {
                status: 'complete',
                toolCalls: plan.calls,
                providerTurn: {
                    provider: input.transport,
                    assistantItems: plan.assistantItems,
                },
            };
        },
    });
}

function expectAnthropicContinuation(request: Record<string, unknown>, expectedIds: readonly string[]): void {
    const messages = request.messages as { role: string; content: unknown }[];
    const toolUses = messages.flatMap((message) => {
        if (message.role !== 'assistant' || !Array.isArray(message.content)) {
            return [];
        }
        return (message.content as { type?: string; id?: string }[]).filter((item) => item.type === 'tool_use');
    });
    const toolResults = messages.flatMap((message) => {
        if (message.role !== 'user' || !Array.isArray(message.content)) {
            return [];
        }
        return (message.content as { type?: string; tool_use_id?: string }[]).filter(
            (item) => item.type === 'tool_result'
        );
    });
    expect(toolUses.map(({ id }) => id)).toEqual(expectedIds);
    expect(toolResults.map(({ tool_use_id }) => tool_use_id)).toEqual(expectedIds);
}

function expectOpenAiContinuation(request: Record<string, unknown>, expectedIds: readonly string[]): void {
    const messages = request.messages as {
        role: string;
        tool_calls?: { id: string }[];
        tool_call_id?: string;
    }[];
    const toolCalls = messages.flatMap((message) => (message.role === 'assistant' ? (message.tool_calls ?? []) : []));
    const toolResults = messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id);
    expect(toolCalls.map(({ id }) => id)).toEqual(expectedIds);
    expect(toolResults).toEqual(expectedIds);
}

beforeEach(() => {
    transportMocks.anthropic.mockReset();
    transportMocks.openAiCompatible.mockReset();
});

describe('scripted provider protocol through the application-owned planning loop', () => {
    // This exercises command-index discovery. Request-dependent measurement and recipe obligations
    // are intentionally outside this protocol fixture.
    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s replays native call and receipt IDs before a normal proposal',
        async (transport) => {
            const requests = installResponses(
                transport,
                PROVIDER_CALLS.map((call, index) =>
                    transport === 'anthropic' ? anthropicResponse(call, index + 1) : openAiResponse(call, index + 1)
                )
            );

            const result = await runScriptedLoop({ transport });

            expect(result).toMatchObject({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'scripted-proposal',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'muteTrack', arguments: { trackId: 'track-1' } }] },
                    },
                ],
                receipts: [
                    { callId: 'scripted-search', toolName: 'agent.command-index.search', status: 'success' },
                    { callId: 'scripted-discovery', toolName: 'agent.catalog.discover', status: 'success' },
                ],
            });
            expect(requests).toHaveLength(3);
            if (transport === 'anthropic') {
                expectAnthropicContinuation(requests[1]!, ['scripted-search']);
                expectAnthropicContinuation(requests[2]!, ['scripted-search', 'scripted-discovery']);
            } else {
                expectOpenAiContinuation(requests[1]!, ['scripted-search']);
                expectOpenAiContinuation(requests[2]!, ['scripted-search', 'scripted-discovery']);
            }
        }
    );

    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s refuses a proposal when command discovery is skipped after a real search',
        async (transport) => {
            const requests = installResponses(
                transport,
                OMIT_DISCOVERY_CALLS.map((call, index) =>
                    transport === 'anthropic' ? anthropicResponse(call, index + 1) : openAiResponse(call, index + 1)
                )
            );

            const result = await runScriptedLoop({ transport });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Provider command proposal referenced an undiscovered catalog command.',
                receipts: [{ callId: 'scripted-search', toolName: 'agent.command-index.search', status: 'success' }],
                turns: 2,
            });
            expect(requests).toHaveLength(2);
            if (transport === 'anthropic') {
                expectAnthropicContinuation(requests[1]!, ['scripted-search']);
            } else {
                expectOpenAiContinuation(requests[1]!, ['scripted-search']);
            }
        }
    );
});
