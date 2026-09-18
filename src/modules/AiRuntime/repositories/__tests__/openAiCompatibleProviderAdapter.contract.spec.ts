import { afterEach, vi } from 'vitest';

import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { generateOpenAiCompatibleToolCalls } from '../cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { streamCloudChatCompletion } from '../cloudLlm/cloudInference/streamCloudChatCompletion';
import { type OpenAiCompatibleCloudRuntime } from '../cloudLlm/cloudSession';

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
    };
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
    return { model: body.model, stream: body.stream };
}

function readSafeMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describeProviderProtocolConformance('OpenAI-compatible chat completions', {
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
