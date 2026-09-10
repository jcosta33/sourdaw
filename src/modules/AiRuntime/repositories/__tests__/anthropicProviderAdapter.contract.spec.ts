import { afterEach, vi } from 'vitest';

import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { generateAnthropicToolCalls } from '../cloudLlm/cloudInference/generateAnthropicToolCalls';
import { streamCloudChatCompletion } from '../cloudLlm/cloudInference/streamCloudChatCompletion';
import { type AnthropicCloudRuntime } from '../cloudLlm/cloudSession';

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
    return event({
        type: 'message_start',
        message: { id: FIXTURE.providerRequestId, ...(usage === undefined ? {} : { usage }) },
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
    return [messageStart(), textDelta(firstDelta ?? ''), textDelta(secondDelta ?? ''), END_TURN, MESSAGE_STOP].join('');
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
    return {
        id: FIXTURE.providerRequestId,
        content: [
            { type: 'tool_use', id: dottedCall?.id, name: dottedCall?.wireName, input: dottedCall?.arguments },
            { type: 'tool_use', id: plainCall?.id, name: plainCall?.wireName, input: plainCall?.arguments },
        ],
        stop_reason: 'tool_use',
    };
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
    return { model: body.model, stream: body.stream };
}

function readSafeMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

afterEach(() => {
    vi.clearAllMocks();
});

describeProviderProtocolConformance('Anthropic messages', {
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
                signal: new AbortController().signal,
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
