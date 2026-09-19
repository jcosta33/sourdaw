import { afterEach, describe, expect, it, vi } from 'vitest';

import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { generateOpenAiResponsesToolCalls } from '../cloudLlm/cloudInference/generateOpenAiResponsesToolCalls';
import { AUTO_TOOL_CHOICE, type HostedToolChoiceDirective } from '../cloudLlm/cloudInference/hostedToolPlan';
import { streamCloudChatCompletion } from '../cloudLlm/cloudInference/streamCloudChatCompletion';
import { type OpenAiCloudRuntime } from '../cloudLlm/cloudSession';
import { compileProviderAdapterInstallation, OPENAI_RESPONSES_ADAPTER_ID } from '../providerAdapterRegistry';

import {
    describeProviderProtocolConformance,
    FORCED_TERMINAL_TOOL_NAMES,
    PROVIDER_CONFORMANCE_FIXTURE as FIXTURE,
    PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
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

const mocks = vi.hoisted(() => ({
    getCloudProviderRuntime: vi.fn(),
    runProviderGatewayRequest: vi.fn(),
}));

vi.mock('../cloudLlm/getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: mocks.getCloudProviderRuntime,
}));

vi.mock('../providerGateway', () => ({
    runProviderGatewayRequest: mocks.runProviderGatewayRequest,
}));

vi.mock('../ensureAdapterCapabilities', () => ({
    ensureAdapterCapabilities: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const runtime: OpenAiCloudRuntime = {
    provider: 'openai',
    model: FIXTURE.model,
    base_url: 'https://api.openai.com/v1',
    authentication: 'api-key',
    adapter: compileProviderAdapterInstallation({
        adapterId: OPENAI_RESPONSES_ADAPTER_ID,
        providerId: 'openai',
        modelId: FIXTURE.model,
        protocolFamily: 'openai-responses',
        origin: 'https://api.openai.com',
    }),
    session_id: `provider-session-${'0'.repeat(32)}`,
};

const [firstDelta, secondDelta] = FIXTURE.textDeltas;
const [dottedCall, plainCall] = FIXTURE.toolCalls;

let sequenceNumber = 0;

function sseEvent(type: string, payload: Record<string, unknown> = {}): string {
    sequenceNumber += 1;
    return `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequenceNumber, ...payload })}\n\n`;
}

function created(id: string): string {
    return sseEvent('response.created', { response: { id, status: 'in_progress' } });
}

function textDelta(text: string): string {
    return sseEvent('response.output_text.delta', { item_id: 'msg-1', output_index: 0, delta: text });
}

function completed(id: string, usage?: Record<string, unknown>): string {
    return sseEvent('response.completed', {
        response: { id, status: 'completed', ...(usage ? { usage } : {}) },
    });
}

function incomplete(reason: string): string {
    return sseEvent('response.incomplete', {
        response: { id: FIXTURE.providerRequestId, status: 'incomplete', incomplete_details: { reason } },
    });
}

function streamFixture(scenario: ProviderStreamScenario): string {
    sequenceNumber = 0;
    if (scenario === 'final-usage') {
        return [
            created(FIXTURE.providerRequestId),
            textDelta(firstDelta ?? ''),
            sseEvent('response.output_text.done', { item_id: 'msg-1', output_index: 0, text: firstDelta ?? '' }),
            completed(FIXTURE.providerRequestId, {
                input_tokens: FIXTURE.usage.inputTokens,
                output_tokens: FIXTURE.usage.outputTokens,
                input_tokens_details: { cached_tokens: 3 },
                output_tokens_details: { reasoning_tokens: 2 },
            }),
        ].join('');
    }
    if (scenario === 'unknown-event') {
        return [
            created(FIXTURE.providerRequestId),
            sseEvent(FIXTURE.unknownEventType, { detail: FIXTURE.providerBodyText }),
            textDelta(firstDelta ?? ''),
            textDelta(secondDelta ?? ''),
            completed(FIXTURE.providerRequestId),
        ].join('');
    }
    if (scenario === 'refusal') {
        return [
            created(FIXTURE.providerRequestId),
            sseEvent('response.refusal.delta', { item_id: 'msg-1', delta: FIXTURE.providerBodyText }),
            incomplete('content_filter'),
        ].join('');
    }
    if (scenario === 'truncation') {
        return [created(FIXTURE.providerRequestId), textDelta(firstDelta ?? ''), incomplete('max_output_tokens')].join(
            ''
        );
    }
    if (scenario === 'cut-stream') {
        return [created(FIXTURE.providerRequestId), textDelta(firstDelta ?? '')].join('');
    }
    if (scenario === 'malformed-event') {
        return `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"${FIXTURE.providerBodyText}"`;
    }
    if (scenario === 'oversized-request-id') {
        return [
            created(FIXTURE.oversizedProviderId),
            textDelta(firstDelta ?? ''),
            completed(FIXTURE.oversizedProviderId),
        ].join('');
    }
    return [
        created(FIXTURE.providerRequestId),
        textDelta(firstDelta ?? ''),
        textDelta(secondDelta ?? ''),
        completed(FIXTURE.providerRequestId),
    ].join('');
}

function functionCall(
    id: string | undefined,
    wireName: string | undefined,
    arguments_: string
): Record<string, unknown> {
    return { type: 'function_call', id: 'fc-item', call_id: id, name: wireName, arguments: arguments_ };
}

function directiveFor(scenario: ProviderToolScenario): HostedToolChoiceDirective {
    if (scenario === 'forced-terminal') {
        return { mode: 'required', toolNames: FORCED_TERMINAL_TOOL_NAMES };
    }
    return AUTO_TOOL_CHOICE;
}

function toolFixture(scenario: ProviderToolScenario): Record<string, unknown> {
    if (scenario === 'empty-batch') {
        return {
            id: FIXTURE.providerRequestId,
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }],
        };
    }
    if (scenario === 'malformed-arguments') {
        return {
            id: FIXTURE.providerRequestId,
            status: 'completed',
            output: [
                functionCall(FIXTURE.malformedArgumentsCallId, 'muteTrack', `{"trackId": ${FIXTURE.providerBodyText}`),
            ],
        };
    }
    if (scenario === 'oversized-call-id') {
        return {
            id: FIXTURE.providerRequestId,
            status: 'completed',
            output: [functionCall(FIXTURE.oversizedProviderId, 'muteTrack', `{"trackId": ${FIXTURE.providerBodyText}`)],
        };
    }
    return {
        id: FIXTURE.providerRequestId,
        status: 'completed',
        output: [
            functionCall(dottedCall?.id, dottedCall?.wireName, JSON.stringify(dottedCall?.arguments)),
            { type: 'reasoning', summary: [] },
            functionCall(plainCall?.id, plainCall?.wireName, JSON.stringify(plainCall?.arguments)),
        ],
        usage: {
            input_tokens: FIXTURE.toolUsage.inputTokens,
            output_tokens: FIXTURE.toolUsage.outputTokens,
            input_tokens_details: { cached_tokens: FIXTURE.toolUsage.cacheReadInputTokens },
        },
    };
}

/** Turn one as this API itself reported it: a reasoning item ahead of the call it produced. */
const OWN_TURN_OUTPUT_ITEMS = [
    { type: 'reasoning', id: HISTORY.assistantMarker, summary: [] },
    {
        type: 'function_call',
        id: 'fc-item',
        call_id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
        name: 'project_query',
        arguments: '{}',
    },
];

const OWN_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'openai',
        assistantItems: OWN_TURN_OUTPUT_ITEMS,
        calls: [{ id: PROVIDER_TURN_HISTORY_RECEIPT.callId, name: 'project.query', arguments: {} }],
        receipts: [PROVIDER_TURN_HISTORY_RECEIPT],
    },
];

/** The same turn as another dialect reported it; none of those items belong on this wire. */
const FOREIGN_TURN_HISTORY: HostedTurnHistory = [
    {
        turn: 1,
        provider: 'anthropic',
        assistantItems: [{ type: 'tool_use', id: HISTORY.foreignMarker, name: 'project_query', input: {} }],
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
        provider: 'openai',
        assistantItems: null,
        calls: [{ id: PROVIDER_SYNTHESISED_TURN_RECEIPT.callId, name: 'project.query', arguments: {} }],
        receipts: [PROVIDER_SYNTHESISED_TURN_RECEIPT],
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
    return null;
}

let sentRequestBodies: string[] = [];

function installProviderResponse(body: string, contentType: string): void {
    sentRequestBodies = [];
    mocks.runProviderGatewayRequest.mockImplementation(
        async (request: {
            body: string | null;
            onResponseStart: (value: { status: number; contentType: string | null }) => void;
            onBodyChunk: (chunk: Uint8Array) => void;
        }) => {
            sentRequestBodies.push(request.body ?? '');
            request.onResponseStart({ status: 200, contentType });
            request.onBodyChunk(new TextEncoder().encode(body));
        }
    );
    mocks.getCloudProviderRuntime.mockReturnValue(runtime);
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() => Promise.reject(new Error('The privileged adapter must not use renderer networking')))
    );
}

function readRequest(): ProviderRequestObservation {
    expect(globalThis.fetch).not.toHaveBeenCalled();
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
        input: body.input,
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
            const plan = await generateOpenAiResponsesToolCalls({
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
        const items = (request.input ?? []) as Record<string, unknown>[];
        return {
            callIds: items.filter((item) => item.type === 'function_call').map((item) => String(item.call_id)),
            resultIds: items.filter((item) => item.type === 'function_call_output').map((item) => String(item.call_id)),
        };
    },
    readWireTool: (tool) => {
        const wireTool = tool as { strict?: unknown; parameters?: unknown };
        return { strict: wireTool.strict, parameters: wireTool.parameters };
    },
};

describeProviderProtocolConformance('OpenAI responses', harness);

describe('generateOpenAiResponsesToolCalls turn history', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('replays every turn-one output item in order and answers each call', async () => {
        const observed = await harness.planTools('two-turn-history');

        expect(observed.request.input).toEqual([
            { role: 'user', content: 'mute drums' },
            ...OWN_TURN_OUTPUT_ITEMS,
            {
                type: 'function_call_output',
                call_id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
                output: JSON.stringify(PROVIDER_TURN_HISTORY_RECEIPT),
            },
            { role: 'user', content: HISTORY.budgetNote },
        ]);
    });

    it('restates a turn another dialect answered as function_call items only', async () => {
        const observed = await harness.planTools('foreign-turn-history');

        const items = observed.request.input as unknown[];
        expect(items[1]).toEqual({
            type: 'function_call',
            call_id: PROVIDER_TURN_HISTORY_RECEIPT.callId,
            name: 'project_query',
            arguments: '{}',
        });
    });
});

describe('generateOpenAiResponsesToolCalls usage admission', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('reads a fractional usage figure as null instead of destroying an admitted plan', async () => {
        installProviderResponse(
            JSON.stringify({
                id: FIXTURE.providerRequestId,
                status: 'completed',
                output: [functionCall(dottedCall?.id, dottedCall?.wireName, JSON.stringify(dottedCall?.arguments))],
                // A sampled or averaged `input_tokens` is not a safe non-negative integer;
                // it must not throw out of `admitEvent`'s usage guard.
                usage: { input_tokens: 12.5, output_tokens: FIXTURE.toolUsage.outputTokens },
            }),
            'application/json'
        );

        const plan = await generateOpenAiResponsesToolCalls({
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
