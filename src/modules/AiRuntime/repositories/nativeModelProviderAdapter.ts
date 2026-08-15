import { isNativeToolCallingProtocolError } from '../errors/NativeToolCallingProtocolError';
import { isToolPlanningRejectedError } from '../errors/ToolPlanningRejectedError';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderEvent,
    type ModelProviderFailure,
    type ModelProviderFinish,
    type ModelProviderRequest,
} from '../models/ModelProviderProtocol';

import { generateNativeCompletion } from './nativeEngine/completions';
import { isNativeEngineReady } from './nativeEngine/isNativeEngineReady';
import { generateNativeToolCalls } from './nativeEngine/nativeToolCalling';
import { generateSchemaConstrainedNativeCompletion } from './nativeEngine/schemaConstrainedGeneration';
import { streamNativeCompletion } from './nativeEngine/streaming';

const DEFAULT_NATIVE_PROVIDER_TIMEOUT_MS = 120_000;

type NativeModelProviderAdapterInput = {
    request: ModelProviderRequest;
    onEvent: (event: ModelProviderEvent) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
};

export type NativeModelProviderAdapterOutcome =
    { status: 'available'; finish: ModelProviderFinish } | { status: 'unavailable'; failure: ModelProviderFailure };

export type NativeModelProviderAdapterDependencies = {
    generateCompletion: typeof generateNativeCompletion;
    generateSchemaConstrainedCompletion: typeof generateSchemaConstrainedNativeCompletion;
    generateToolCalls: typeof generateNativeToolCalls;
    isReady: typeof isNativeEngineReady;
    streamCompletion: typeof streamNativeCompletion;
};

const productionDependencies: NativeModelProviderAdapterDependencies = {
    generateCompletion: generateNativeCompletion,
    generateSchemaConstrainedCompletion: generateSchemaConstrainedNativeCompletion,
    generateToolCalls: generateNativeToolCalls,
    isReady: isNativeEngineReady,
    streamCompletion: streamNativeCompletion,
};

function unavailableFailure(request: ModelProviderRequest, code: string, safeMessage: string): ModelProviderFailure {
    return {
        code,
        correlationId: request.correlationId,
        retryable: true,
        safeMessage,
        partialOutputDisposition: 'none',
    };
}

function errorFinish(code: string, safeMessage: string, retryable = true): ModelProviderFinish {
    return {
        reason: 'error',
        failure: { code, retryable, safeMessage },
    };
}

function readPrompts(request: ModelProviderRequest): { systemPrompt: string; userMessage: string } | null {
    const systemPrompt = request.messages.find((message) => message.role === 'system')?.content;
    const userMessage = request.messages.findLast((message) => message.role === 'user')?.content;
    return systemPrompt === undefined || userMessage === undefined ? null : { systemPrompt, userMessage };
}

function parseStructuredOutput(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error('Native structured output was not valid JSON', { cause: error });
    }
}

export async function runNativeModelProviderRequest(
    input: NativeModelProviderAdapterInput,
    dependencies: NativeModelProviderAdapterDependencies = productionDependencies
): Promise<NativeModelProviderAdapterOutcome> {
    if (input.request.schemaVersion !== MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION) {
        return {
            status: 'unavailable',
            failure: unavailableFailure(
                input.request,
                'native-protocol-version-unsupported',
                'The native model provider request uses an unsupported protocol version.'
            ),
        };
    }
    if (!dependencies.isReady()) {
        return {
            status: 'unavailable',
            failure: unavailableFailure(
                input.request,
                'native-provider-unavailable',
                'The native model provider is not running.'
            ),
        };
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_NATIVE_PROVIDER_TIMEOUT_MS;
    try {
        input.signal?.throwIfAborted();
        if (input.request.operation === 'text') {
            if (input.request.stream) {
                let finishReason: 'stop' | 'length' = 'stop';
                await dependencies.streamCompletion(
                    input.request.messages,
                    (text) => input.onEvent({ type: 'text', mode: 'delta', text }),
                    {
                        maxTokens: input.request.limits.maxOutputTokens,
                        timeoutMs,
                        ...(input.signal === undefined ? {} : { signal: input.signal }),
                        onUsage: input.onEvent,
                        onUnknownEvent: (providerEventType) => input.onEvent({ type: 'unknown', providerEventType }),
                        onFinish: (reason) => {
                            finishReason = reason;
                        },
                    }
                );
                return { status: 'available', finish: { reason: finishReason } };
            } else {
                const prompts = readPrompts(input.request);
                if (prompts === null) {
                    return {
                        status: 'available',
                        finish: errorFinish(
                            'invalid-native-provider-request',
                            'The native model provider request is missing required messages.',
                            false
                        ),
                    };
                }
                const text = await dependencies.generateCompletion(prompts.systemPrompt, prompts.userMessage, {
                    maxTokens: input.request.limits.maxOutputTokens,
                    requireComplete: true,
                    timeoutMs,
                    ...(input.signal === undefined ? {} : { signal: input.signal }),
                });
                input.onEvent({ type: 'text', mode: 'cumulative-snapshot', text });
            }
            return { status: 'available', finish: { reason: 'stop' } };
        }

        const prompts = readPrompts(input.request);
        if (prompts === null) {
            return {
                status: 'available',
                finish: errorFinish(
                    'invalid-native-provider-request',
                    'The native model provider request is missing required messages.',
                    false
                ),
            };
        }

        if (input.request.operation === 'tools') {
            const toolCalls = await dependencies.generateToolCalls({
                ...prompts,
                tools: (input.request.tools ?? []).map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                })),
                temperature: 0.1,
                timeoutMs,
                ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
            if (toolCalls === null) {
                return {
                    status: 'available',
                    finish: errorFinish(
                        'native-tools-unavailable',
                        'The native model provider could not produce structured tool calls.'
                    ),
                };
            }
            for (const [index, call] of toolCalls.entries()) {
                input.onEvent({
                    type: 'tool-call',
                    call: {
                        id: call.id ?? `${input.request.correlationId}:${String(index)}`,
                        name: call.name,
                        arguments: call.arguments,
                    },
                });
            }
            return { status: 'available', finish: { reason: 'stop' } };
        }

        const serialized = await dependencies.generateSchemaConstrainedCompletion({
            ...prompts,
            jsonSchema: JSON.stringify(input.request.responseSchema),
            maxTokens: input.request.limits.maxOutputTokens,
            timeoutMs,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        if (serialized === null) {
            return {
                status: 'available',
                finish: errorFinish(
                    'native-structured-output-unavailable',
                    'The native model provider could not produce structured output.'
                ),
            };
        }
        input.onEvent({ type: 'structured-output', value: parseStructuredOutput(serialized) });
        return { status: 'available', finish: { reason: 'stop' } };
    } catch (error) {
        if (isToolPlanningRejectedError(error)) {
            return {
                status: 'available',
                finish: errorFinish('tool-planning-rejected', error.message, false),
            };
        }
        if (isNativeToolCallingProtocolError(error)) {
            return {
                status: 'available',
                finish: errorFinish(
                    'native-tool-protocol-invalid',
                    'The native model provider returned an invalid tool response.'
                ),
            };
        }
        if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            return { status: 'available', finish: { reason: 'cancelled' } };
        }
        const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || /timed out/i.test(error.message));
        const isLength = error instanceof Error && /finish reason length/i.test(error.message);
        if (isLength) {
            return { status: 'available', finish: { reason: 'length' } };
        }
        return {
            status: 'available',
            finish: errorFinish(
                isTimeout ? 'native-provider-timeout' : 'native-provider-failed',
                isTimeout ? 'The native model provider request timed out.' : 'The native model provider request failed.'
            ),
        };
    }
}
