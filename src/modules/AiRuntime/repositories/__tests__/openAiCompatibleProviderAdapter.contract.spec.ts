import { afterEach, describe, expect, it, vi } from 'vitest';

import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { generateOpenAiCompatibleToolCalls } from '../cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { AUTO_TOOL_CHOICE, type HostedToolChoiceDirective } from '../cloudLlm/cloudInference/hostedToolPlan';
import { streamCloudChatCompletion } from '../cloudLlm/cloudInference/streamCloudChatCompletion';
import { type OpenAiCompatibleCloudRuntime } from '../cloudLlm/cloudSession';

import {
    describeProviderProtocolConformance,
    FORCED_TERMINAL_TOOL_NAMES,
    MULTI_CALL_TURN_CALL_IDS,
    PROVIDER_CONFORMANCE_FIXTURE as FIXTURE,
    PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
    PROVIDER_MULTI_CALL_TURN_RECEIPTS,
    PROVIDER_TURN_HISTORY_FIXTURE as HISTORY,
    PROVIDER_SYNTHESISED_TURN_RECEIPT,
    PROVIDER_TURN_HISTORY_RECEIPT,
    type ProviderCorrelationObservation,
    type ProviderProtocolHarness,
    type ProviderRequestObservation,
    type ProviderStreamObservation,
    type ProviderStreamScenario,
    type ProviderToolObservation,
    type ProviderToolScenario,
} from './providerProtocolConformance';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

const mocks = vi.hoisted(() => ({ getCloudProviderRuntime: vi.fn() }));

vi.mock('../cloudLlm/getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: mocks.getCloudProviderRuntime,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const runtime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: FIXTURE.model,
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: true,
};

const [firstDelta, secondDelta] = FIXTURE.textDeltas;
const [dottedCall, plainCall] = FIXTURE.toolCalls;

function event(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify({ id: FIXTURE.providerRequestId, ...payload })}\n\n`;
}

function eventWithId(id: string, payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify({ id, ...payload })}\n\n`;
}

function delta(content: string): string {
    return event({ choices: [{ delta: { content } }] });
}

function finish(reason: string): string {
    return event({ choices: [{ delta: {}, finish_reason: reason }] });
}

const DONE = 'data: [DONE]\n\n';

function streamFixture(scenario: ProviderStreamScenario): string {
    if (scenario === 'final-usage') {
        return [
            delta(firstDelta ?? ''),
            finish('stop'),
            event({
                choices: [],
                usage: {
                    prompt_tokens: FIXTURE.usage.inputTokens,
                    completion_tokens: FIXTURE.usage.outputTokens,
                },
            }),
            DONE,
        ].join('');
    }
    if (scenario === 'unknown-event') {
        return [
            `data: ${JSON.stringify({ type: FIXTURE.unknownEventType, detail: FIXTURE.providerBodyText })}\n\n`,
            delta(firstDelta ?? ''),
            delta(secondDelta ?? ''),
            finish('stop'),
            DONE,
        ].join('');
    }
    if (scenario === 'refusal') {
        return [event({ choices: [{ delta: { refusal: FIXTURE.providerBodyText } }] }), finish('stop'), DONE].join('');
    }
    if (scenario === 'truncation') {
        return [delta(firstDelta ?? ''), finish('length'), DONE].join('');
    }
    if (scenario === 'cut-stream') {
        return [delta(firstDelta ?? ''), finish('stop')].join('');
    }
    if (scenario === 'malformed-event') {
        return `data: {"choices":[{"delta":{"content":"${FIXTURE.providerBodyText}"\n\n`;
    }
    if (scenario === 'oversized-request-id') {
        return [
            eventWithId(FIXTURE.oversizedProviderId, { choices: [{ delta: { content: firstDelta ?? '' } }] }),
            eventWithId(FIXTURE.oversizedProviderId, { choices: [{ delta: {}, finish_reason: 'stop' }] }),
            DONE,
        ].join('');
    }
    return [delta(firstDelta ?? ''), delta(secondDelta ?? ''), finish('stop'), DONE].join('');
}

function directiveFor(scenario: ProviderToolScenario): HostedToolChoiceDirective {
    if (scenario === 'forced-terminal') {
        return { mode: 'required', toolNames: FORCED_TERMINAL_TOOL_NAMES };
    }
    return AUTO_TOOL_CHOICE;
}

function toolFixture(scenario: ProviderToolScenario): Record<string, unknown> {
    if (scenario === 'empty-batch') {
        return { id: FIXTURE.providerRequestId, choices: [{ finish_reason: 'stop', message: { content: '' } }] };
    }
    if (scenario === 'malformed-arguments') {
        return {
            id: FIXTURE.providerRequestId,
            choices: [
                {
                    finish_reason: 'tool_calls',
                    message: {
                        tool_calls: [
                            {
                                id: FIXTURE.malformedArgumentsCallId,
                                function: {
                                    name: 'muteTrack',
                                    arguments: `{"trackId": ${FIXTURE.providerBodyText}`,
                                },
                            },
                        ],
                    },
                },
            ],
        };
    }
    if (scenario === 'oversized-call-id') {
        return {
            id: FIXTURE.providerRequestId,
            choices: [
                {
                    finish_reason: 'tool_calls',
                    message: {
                        tool_calls: [
                            {
                                id: FIXTURE.oversizedProviderId,
                                function: {
                                    name: 'muteTrack',
                                    arguments: `{"trackId": ${FIXTURE.providerBodyText}`,
                                },
                            },
                        ],
                    },
                },
            ],
        };
    }
    return {
        id: FIXTURE.providerRequestId,
        choices: [
            {
                finish_reason: 'tool_calls',
                message: {
                    tool_calls: [
                        {
                            id: dottedCall?.id,
                            function: { name: dottedCall?.wireName, arguments: JSON.stringify(dottedCall?.arguments) },
                        },
                        {
                            id: plainCall?.id,
                            function: { name: plainCall?.wireName, arguments: JSON.stringify(plainCall?.arguments) },
                        },
                    ],
                },
            },
        ],
        usage: {
            prompt_tokens: FIXTURE.toolUsage.inputTokens,
            completion_tokens: FIXTURE.toolUsage.outputTokens,
            prompt_tokens_details: { cached_tokens: FIXTURE.toolUsage.cacheReadInputTokens },
        },
    };
}

/** Turn one as this dialect itself reported it: the assistant message, verbatim. */
const OWN_TURN_ASSISTANT_MESSAGE = {
    role: 'assistant',
    content: HISTORY.assistantMarker,
    tool_calls: [
        {
            id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
            type: 'function',
            function: { name: 'project_query', arguments: '{}' },
        },
    ],
};

const OWN_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'openai-compatible',
        assistantItems: [OWN_TURN_ASSISTANT_MESSAGE],
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

/** A turn whose call the provider never named, recorded under the identity the loop resolved. */
const SYNTHESISED_ID_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'anthropic',
        assistantItems: [],
        calls: [{ id: PROVIDER_SYNTHESISED_TURN_RECEIPT.callId, name: 'project.query', arguments: {} }],
        receipts: [PROVIDER_SYNTHESISED_TURN_RECEIPT],
    },
];

/** This dialect's own turn, whose call it never named: no items the receipt can answer. */
const UNIDENTIFIED_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'openai-compatible',
        assistantItems: null,
        calls: [{ id: PROVIDER_SYNTHESISED_TURN_RECEIPT.callId, name: 'project.query', arguments: {} }],
        receipts: [PROVIDER_SYNTHESISED_TURN_RECEIPT],
    },
];

/** One turn carrying two calls the provider never named, each with its own receipt. */
const MULTI_CALL_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'openai-compatible',
        assistantItems: null,
        calls: [
            { id: MULTI_CALL_TURN_CALL_IDS[0], name: 'project.query', arguments: {} },
            { id: MULTI_CALL_TURN_CALL_IDS[1], name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
        ],
        receipts: PROVIDER_MULTI_CALL_TURN_RECEIPTS,
    },
];

function turnHistoryFor(scenario: ProviderToolScenario): { history: HostedTurnHistory; budgetNote: string } | null {
    if (scenario === 'two-turn-history') {
        return { history: OWN_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    if (scenario === 'foreign-turn-history') {
        return { history: FOREIGN_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    if (scenario === 'synthesised-call-id-history') {
        return { history: SYNTHESISED_ID_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    if (scenario === 'unidentified-turn-history') {
        return { history: UNIDENTIFIED_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    if (scenario === 'multi-call-turn-history') {
        return { history: MULTI_CALL_TURN_HISTORY, budgetNote: HISTORY.budgetNote };
    }
    return null;
}

let sentRequestBodies: string[] = [];

function installProviderResponse(body: string, contentType: string): void {
    sentRequestBodies = [];
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>((_input, init) => {
            sentRequestBodies.push(typeof init?.body === 'string' ? init.body : '');
            return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': contentType } }));
        })
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
    vi.unstubAllGlobals();
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
            const plan = await generateOpenAiCompatibleToolCalls({
                runtime,
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
                maxOutputTokens: 8_192,
                directive: directiveFor(scenario),
                ...(turnHistoryFor(scenario) ?? {}),
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
    readCorrelatingIds: (request): ProviderCorrelationObservation => {
        const messages = (request.messages ?? []) as Record<string, unknown>[];
        const results = messages.filter((message) => message.role === 'tool');
        return {
            callIds: messages.flatMap((message) => {
                if (!Array.isArray(message.tool_calls)) {
                    return [];
                }
                return (message.tool_calls as Record<string, unknown>[]).map((call) => String(call.id));
            }),
            resultIds: results.map((message) => String(message.tool_call_id)),
            resultPayloads: results.map((message) => String(message.content)),
        };
    },
    readWireTool: (tool) => {
        const wireTool = tool as { function?: { strict?: unknown; parameters?: unknown } };
        return { strict: wireTool.function?.strict, parameters: wireTool.function?.parameters };
    },
};

describeProviderProtocolConformance('OpenAI-compatible chat completions', harness);

describe('generateOpenAiCompatibleToolCalls turn history', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('replays the assistant message it received and answers it with tool messages', async () => {
        const observed = await harness.planTools('two-turn-history');

        expect(observed.request.messages).toEqual([
            { role: 'system', content: 'system' },
            { role: 'user', content: 'mute drums' },
            OWN_TURN_ASSISTANT_MESSAGE,
            {
                role: 'tool',
                tool_call_id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
                content: JSON.stringify(PROVIDER_TURN_HISTORY_RECEIPT),
            },
            { role: 'user', content: HISTORY.budgetNote },
        ]);
    });

    it('restates a turn another dialect answered as an assistant tool-call message only', async () => {
        const observed = await harness.planTools('foreign-turn-history');

        const messages = observed.request.messages as unknown[];
        expect(messages[2]).toEqual({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
                    type: 'function',
                    function: { name: 'project_query', arguments: '{}' },
                },
            ],
        });
    });
});

describe('generateOpenAiCompatibleToolCalls usage admission', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('reads a fractional usage figure as null instead of destroying an admitted plan', async () => {
        installProviderResponse(
            JSON.stringify({
                id: FIXTURE.providerRequestId,
                choices: [
                    {
                        finish_reason: 'tool_calls',
                        message: {
                            tool_calls: [
                                {
                                    id: dottedCall?.id,
                                    function: {
                                        name: dottedCall?.wireName,
                                        arguments: JSON.stringify(dottedCall?.arguments),
                                    },
                                },
                            ],
                        },
                    },
                ],
                // A sampled or averaged `prompt_tokens` is not a safe non-negative integer;
                // it must not throw out of `admitEvent`'s usage guard.
                usage: { prompt_tokens: 12.5, completion_tokens: FIXTURE.toolUsage.outputTokens },
            }),
            'application/json'
        );

        const plan = await generateOpenAiCompatibleToolCalls({
            runtime,
            systemPrompt: 'system',
            userMessage: 'mute drums',
            toolSchemas: PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
            maxOutputTokens: 8_192,
            directive: AUTO_TOOL_CHOICE,
        });

        expect(plan.usage).toMatchObject({ inputTokens: null, outputTokens: FIXTURE.toolUsage.outputTokens });
    });
});
