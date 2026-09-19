import { afterEach, describe, expect, it, vi } from 'vitest';

import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { generateAnthropicToolCalls } from '../cloudLlm/cloudInference/generateAnthropicToolCalls';
import { AUTO_TOOL_CHOICE, type HostedToolChoiceDirective } from '../cloudLlm/cloudInference/hostedToolPlan';
import { streamCloudChatCompletion } from '../cloudLlm/cloudInference/streamCloudChatCompletion';
import { type AnthropicCloudRuntime } from '../cloudLlm/cloudSession';

import {
    describeProviderProtocolConformance,
    FORCED_TERMINAL_TOOL_NAMES,
    PROVIDER_CONFORMANCE_FIXTURE as FIXTURE,
    PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
    PROVIDER_TURN_HISTORY_FIXTURE as HISTORY,
    PROVIDER_TURN_HISTORY_RECEIPT,
    type ProviderProtocolHarness,
    type ProviderRequestObservation,
    type ProviderStreamObservation,
    type ProviderStreamScenario,
    type ProviderToolObservation,
    type ProviderToolScenario,
} from './providerProtocolConformance';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

const mocks = vi.hoisted(() => ({
    getCloudProviderRuntime: vi.fn(),
    requestAnthropicProvider: vi.fn(),
}));

vi.mock('../cloudLlm/getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: mocks.getCloudProviderRuntime,
}));

vi.mock('../cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: mocks.requestAnthropicProvider,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const runtime: AnthropicCloudRuntime = {
    provider: 'anthropic',
    authentication: 'api-key',
    session_id: 'provider-session-00000000000000000000000000000000',
    model: FIXTURE.model,
};

const [firstDelta, secondDelta] = FIXTURE.textDeltas;
const [dottedCall, plainCall] = FIXTURE.toolCalls;

function event(payload: Record<string, unknown>): string {
    return `event: ${String(payload.type)}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function messageStart(usage?: Record<string, number>): string {
    return messageStartWithId(FIXTURE.providerRequestId, usage);
}

function messageStartWithId(id: string, usage?: Record<string, number>): string {
    return event({
        type: 'message_start',
        message: { id, ...(usage === undefined ? {} : { usage }) },
    });
}

function textDelta(text: string): string {
    return event({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
}

function messageDelta(delta: Record<string, unknown>, usage?: Record<string, number>): string {
    return event({ type: 'message_delta', delta, ...(usage === undefined ? {} : { usage }) });
}

const MESSAGE_STOP = event({ type: 'message_stop' });
const END_TURN = messageDelta({ stop_reason: 'end_turn', stop_sequence: null });

function streamFixture(scenario: ProviderStreamScenario): string {
    if (scenario === 'final-usage') {
        return [
            messageStart({ input_tokens: FIXTURE.usage.inputTokens, output_tokens: 0 }),
            textDelta(firstDelta ?? ''),
            messageDelta(
                { stop_reason: 'end_turn', stop_sequence: null },
                { input_tokens: FIXTURE.usage.inputTokens, output_tokens: FIXTURE.usage.outputTokens }
            ),
            MESSAGE_STOP,
        ].join('');
    }
    if (scenario === 'unknown-event') {
        return [
            messageStart(),
            event({ type: FIXTURE.unknownEventType, detail: FIXTURE.providerBodyText }),
            textDelta(firstDelta ?? ''),
            textDelta(secondDelta ?? ''),
            END_TURN,
            MESSAGE_STOP,
        ].join('');
    }
    if (scenario === 'refusal') {
        return [
            messageStart(),
            messageDelta({ stop_reason: 'refusal', stop_sequence: null, detail: FIXTURE.providerBodyText }),
            MESSAGE_STOP,
        ].join('');
    }
    if (scenario === 'truncation') {
        return [
            messageStart(),
            textDelta(firstDelta ?? ''),
            messageDelta({ stop_reason: 'max_tokens', stop_sequence: null }),
            MESSAGE_STOP,
        ].join('');
    }
    if (scenario === 'cut-stream') {
        // Stops after the terminal delta and before `message_stop`, mirroring the
        // OpenAI fixture that omits `[DONE]`: the stop reason arrived, the
        // terminal marker never did.
        return [messageStart(), textDelta(firstDelta ?? ''), END_TURN].join('');
    }
    if (scenario === 'malformed-event') {
        return `data: {invalid ${FIXTURE.providerBodyText}}\n\n`;
    }
    if (scenario === 'oversized-request-id') {
        return [
            messageStartWithId(FIXTURE.oversizedProviderId),
            textDelta(firstDelta ?? ''),
            END_TURN,
            MESSAGE_STOP,
        ].join('');
    }
    return [messageStart(), textDelta(firstDelta ?? ''), textDelta(secondDelta ?? ''), END_TURN, MESSAGE_STOP].join('');
}

function directiveFor(scenario: ProviderToolScenario): HostedToolChoiceDirective {
    if (scenario === 'forced-terminal') {
        return { mode: 'required', toolNames: FORCED_TERMINAL_TOOL_NAMES };
    }
    return AUTO_TOOL_CHOICE;
}

function toolFixture(scenario: ProviderToolScenario): Record<string, unknown> {
    if (scenario === 'empty-batch') {
        return { id: FIXTURE.providerRequestId, content: [], stop_reason: 'end_turn' };
    }
    if (scenario === 'malformed-arguments') {
        return {
            id: FIXTURE.providerRequestId,
            content: [
                {
                    type: 'tool_use',
                    id: FIXTURE.malformedArgumentsCallId,
                    name: 'muteTrack',
                    input: `{"trackId": ${FIXTURE.providerBodyText}`,
                },
            ],
            stop_reason: 'tool_use',
        };
    }
    if (scenario === 'oversized-call-id') {
        return {
            id: FIXTURE.providerRequestId,
            content: [
                {
                    type: 'tool_use',
                    id: FIXTURE.oversizedProviderId,
                    name: 'muteTrack',
                    input: `{"trackId": ${FIXTURE.providerBodyText}`,
                },
            ],
            stop_reason: 'tool_use',
        };
    }
    return {
        id: FIXTURE.providerRequestId,
        content: [
            { type: 'tool_use', id: dottedCall?.id, name: dottedCall?.wireName, input: dottedCall?.arguments },
            { type: 'tool_use', id: plainCall?.id, name: plainCall?.wireName, input: plainCall?.arguments },
        ],
        stop_reason: 'tool_use',
        usage: {
            input_tokens: FIXTURE.toolUsage.inputTokens,
            output_tokens: FIXTURE.toolUsage.outputTokens,
            cache_read_input_tokens: FIXTURE.toolUsage.cacheReadInputTokens,
            cache_creation_input_tokens: 8,
        },
    };
}

/** Turn one as this provider itself reported it: a thinking block beside the tool use. */
const OWN_TURN_ASSISTANT_ITEMS = [
    { type: 'text', text: HISTORY.assistantMarker },
    { type: 'tool_use', id: PROVIDER_TURN_HISTORY_RECEIPT.callId, name: 'project_query', input: {} },
];

const OWN_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'anthropic',
        assistantItems: OWN_TURN_ASSISTANT_ITEMS,
        calls: [{ id: PROVIDER_TURN_HISTORY_RECEIPT.callId, name: 'project.query', arguments: {} }],
        receipts: [PROVIDER_TURN_HISTORY_RECEIPT],
    },
];

/** The same turn as another dialect reported it; none of those items belong on this wire. */
const FOREIGN_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'openai',
        assistantItems: [
            { type: 'reasoning', id: HISTORY.foreignMarker, summary: [] },
            {
                type: 'function_call',
                call_id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
                name: 'project_query',
                arguments: '{}',
            },
        ],
        calls: [{ id: PROVIDER_TURN_HISTORY_RECEIPT.callId, name: 'project.query', arguments: {} }],
        receipts: [PROVIDER_TURN_HISTORY_RECEIPT],
    },
];

function turnHistoryFor(scenario: ProviderToolScenario): { history: HostedTurnHistory; budgetNote: string } | null {
    if (scenario === 'two-turn-history') {
        return { history: OWN_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    if (scenario === 'foreign-turn-history') {
        return { history: FOREIGN_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    return null;
}

let sentRequestBodies: string[] = [];

function installProviderResponse(body: string, contentType: string): void {
    sentRequestBodies = [];
    mocks.requestAnthropicProvider.mockImplementation(
        (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
            sentRequestBodies.push(request.body);
            request.onBodyChunk(new TextEncoder().encode(body));
            return Promise.resolve({ status: 200, contentType });
        }
    );
    mocks.getCloudProviderRuntime.mockReturnValue(runtime);
}

function readRequest(): ProviderRequestObservation {
    const sent = sentRequestBodies[0];
    if (sent === undefined || sent.length === 0) {
        throw new Error('Expected the adapter to send a JSON request body');
    }
    const body = JSON.parse(sent) as Record<string, unknown>;
    return {
        model: body.model,
        stream: body.stream,
        tools: body.tools,
        toolChoice: body.tool_choice,
        messages: body.messages,
    };
}

function readSafeMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

afterEach(() => {
    vi.clearAllMocks();
});

const harness: ProviderProtocolHarness = {
    streamText: async (scenario: ProviderStreamScenario): Promise<ProviderStreamObservation> => {
        installProviderResponse(streamFixture(scenario), 'text/event-stream');
        let text = '';
        const usageEvents: ModelProviderUsageEvent[] = [];
        const unknownEvents: string[] = [];
        try {
            const outcome = await streamCloudChatCompletion(
                [{ role: 'user', content: 'lower the vocals' }],
                (token) => {
                    text += token;
                },
                {
                    onUsage: (usageEvent) => usageEvents.push(usageEvent),
                    onUnknownEvent: (providerEventType) => unknownEvents.push(providerEventType),
                }
            );
            return {
                text,
                usageEvents,
                unknownEvents,
                finish: outcome.status === 'complete' ? 'stop' : outcome.finishReason,
                ...(outcome.status === 'complete' ? {} : { failure: { safeMessage: outcome.safeMessage } }),
                providerRequestId: outcome.providerRequestId,
                request: readRequest(),
            };
        } catch (error) {
            return {
                text,
                usageEvents,
                unknownEvents,
                finish: 'error',
                failure: { safeMessage: readSafeMessage(error) },
                providerRequestId: null,
                request: readRequest(),
            };
        }
    },
    planTools: async (scenario: ProviderToolScenario): Promise<ProviderToolObservation> => {
        installProviderResponse(JSON.stringify(toolFixture(scenario)), 'application/json');
        try {
            const plan = await generateAnthropicToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
                maxOutputTokens: 8_192,
                directive: directiveFor(scenario),
                ...(turnHistoryFor(scenario) ?? {}),
                signal: new AbortController().signal,
            });
            return {
                calls: plan.calls,
                providerRequestId: plan.providerRequestId,
                request: readRequest(),
                usage: plan.usage,
            };
        } catch (error) {
            return {
                calls: [],
                providerRequestId: null,
                failure: { safeMessage: readSafeMessage(error) },
                request: readRequest(),
                usage: null,
            };
        }
    },
    readWireTool: (tool) => {
        const wireTool = tool as { strict?: unknown; input_schema?: unknown };
        return { strict: wireTool.strict, parameters: wireTool.input_schema };
    },
};

describeProviderProtocolConformance('Anthropic messages', harness);

describe('generateAnthropicToolCalls turn history', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("replays the provider's own turn-one blocks and answers them with tool results", async () => {
        const observed = await harness.planTools('two-turn-history');

        expect(observed.request.messages).toEqual([
            { role: 'user', content: 'mute drums' },
            { role: 'assistant', content: OWN_TURN_ASSISTANT_ITEMS },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
                        content: JSON.stringify(PROVIDER_TURN_HISTORY_RECEIPT),
                    },
                    { type: 'text', text: HISTORY.budgetNote },
                ],
            },
        ]);
    });

    it('sends the same first user message a first turn sends', async () => {
        const firstTurn = await harness.planTools('tool-batch');
        const secondTurn = await harness.planTools('two-turn-history');

        const firstMessages = firstTurn.request.messages as unknown[];
        const secondMessages = secondTurn.request.messages as unknown[];
        expect(secondMessages[0]).toEqual(firstMessages[0]);
    });

    it('restates a turn another dialect answered as tool_use blocks only', async () => {
        const observed = await harness.planTools('foreign-turn-history');

        const messages = observed.request.messages as unknown[];
        expect(messages[1]).toEqual({
            role: 'assistant',
            content: [
                {
                    type: 'tool_use',
                    id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
                    name: 'project_query',
                    input: {},
                },
            ],
        });
    });
});

describe('generateAnthropicToolCalls usage admission', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('reads a fractional usage figure as null instead of destroying an admitted plan', async () => {
        installProviderResponse(
            JSON.stringify({
                id: FIXTURE.providerRequestId,
                content: [
                    { type: 'tool_use', id: dottedCall?.id, name: dottedCall?.wireName, input: dottedCall?.arguments },
                ],
                stop_reason: 'tool_use',
                // A sampled or averaged `input_tokens` is not a safe non-negative integer;
                // it must not throw out of `admitEvent`'s usage guard.
                usage: { input_tokens: 12.5, output_tokens: FIXTURE.toolUsage.outputTokens },
            }),
            'application/json'
        );

        const plan = await generateAnthropicToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'mute drums',
            toolSchemas: PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
            maxOutputTokens: 8_192,
            directive: AUTO_TOOL_CHOICE,
            signal: new AbortController().signal,
        });

        expect(plan.usage).toMatchObject({ inputTokens: null, outputTokens: FIXTURE.toolUsage.outputTokens });
    });
});
