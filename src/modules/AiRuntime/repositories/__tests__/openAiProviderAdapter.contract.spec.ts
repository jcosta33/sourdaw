import { afterEach, expect, vi } from 'vitest';

import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { generateOpenAiResponsesToolCalls } from '../cloudLlm/cloudInference/generateOpenAiResponsesToolCalls';
import { streamCloudChatCompletion } from '../cloudLlm/cloudInference/streamCloudChatCompletion';
import { type OpenAiCloudRuntime } from '../cloudLlm/cloudSession';
import { compileProviderAdapterInstallation, OPENAI_RESPONSES_ADAPTER_ID } from '../providerAdapterRegistry';

import {
    describeProviderProtocolConformance,
    PROVIDER_CONFORMANCE_FIXTURE as FIXTURE,
    PROVIDER_CONFORMANCE_TOOL_SCHEMAS,
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
    };
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
    return { model: body.model, stream: body.stream };
}

function readSafeMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describeProviderProtocolConformance('OpenAI responses', {
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
            });
            return {
                calls: plan.calls,
                providerRequestId: plan.providerRequestId,
                request: readRequest(),
            };
        } catch (error) {
            return {
                calls: [],
                providerRequestId: null,
                failure: { safeMessage: readSafeMessage(error) },
                request: readRequest(),
            };
        }
    },
});
