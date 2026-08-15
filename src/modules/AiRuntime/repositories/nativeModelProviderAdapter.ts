import { isNativeToolCallingProtocolError } from '../errors/NativeToolCallingProtocolError';
import { isToolPlanningRejectedError } from '../errors/ToolPlanningRejectedError';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderEvent,
    type ModelProviderEventEnvelope,
    type ModelProviderFailure,
    type ModelProviderFinish,
    type ModelProviderFinishEnvelope,
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
    onEvent: (event: ModelProviderEventEnvelope) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
};

export type NativeModelProviderAdapterOutcome =
    | { status: 'available'; finish: ModelProviderFinishEnvelope }
    | { status: 'unavailable'; failure: ModelProviderFailure };

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

function hasUnsupportedConversationHistory(request: ModelProviderRequest): boolean {
    const hasSystemMessage = request.messages.some((message) => message.role === 'system');
    const hasUserMessage = request.messages.some((message) => message.role === 'user');
    if (!hasSystemMessage || !hasUserMessage) {
        return false;
    }
    return (
        request.messages.length !== 2 || request.messages[0]?.role !== 'system' || request.messages[1]?.role !== 'user'
    );
}

function hasUnsupportedStreamHistory(request: ModelProviderRequest): boolean {
    const systemMessageCount = request.messages.filter((message) => message.role === 'system').length;
    return (
        systemMessageCount > 1 ||
        request.messages.some((message) => message.role === 'tool') ||
        (systemMessageCount === 1 && request.messages[0]?.role !== 'system')
    );
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

    let sequence = 0;
    let terminalEmitted = false;
    const identity = {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: input.request.runId,
        requestId: input.request.requestId,
        correlationId: input.request.correlationId,
        cancellationGeneration: input.request.cancellationGeneration,
    } as const;
    const emit = (event: ModelProviderEvent): void => {
        if (terminalEmitted) {
            throw new TypeError('Native provider emitted an event after its terminal outcome.');
        }
        input.onEvent({ ...identity, sequence, event });
        sequence += 1;
    };
    const terminal = (finish: ModelProviderFinish): ModelProviderFinishEnvelope => {
        if (terminalEmitted) {
            throw new TypeError('Native provider emitted more than one terminal outcome.');
        }
        terminalEmitted = true;
        const envelope = { ...identity, sequence, finish };
        sequence += 1;
        return envelope;
    };
    const terminalError = (code: string, safeMessage: string, retryable = true): ModelProviderFinishEnvelope =>
        terminal(errorFinish(code, safeMessage, retryable));

    const timeoutMs = input.timeoutMs ?? DEFAULT_NATIVE_PROVIDER_TIMEOUT_MS;
    try {
        input.signal?.throwIfAborted();
        if (input.request.operation === 'text' && input.request.stream && hasUnsupportedStreamHistory(input.request)) {
            return {
                status: 'available',
                finish: terminalError(
                    'native-conversation-history-unsupported',
                    'The native model provider does not support this conversation history.',
                    false
                ),
            };
        }
        if (
            (input.request.operation !== 'text' || !input.request.stream) &&
            hasUnsupportedConversationHistory(input.request)
        ) {
            return {
                status: 'available',
                finish: terminalError(
                    'native-conversation-history-unsupported',
                    'The native model provider does not support this conversation history.',
                    false
                ),
            };
        }
        if (input.request.operation === 'text') {
            if (input.request.stream) {
                let finishReason: 'stop' | 'length' | undefined;
                await dependencies.streamCompletion(
                    input.request.messages,
                    (text) => emit({ type: 'text', mode: 'delta', text }),
                    {
                        maxTokens: input.request.limits.maxOutputTokens,
                        timeoutMs,
                        ...(input.signal === undefined ? {} : { signal: input.signal }),
                        onUsage: emit,
                        onUnknownEvent: (providerEventType) => emit({ type: 'unknown', providerEventType }),
                        onFinish: (reason) => {
                            finishReason = reason;
                        },
                    }
                );
                if (finishReason === undefined) {
                    return {
                        status: 'available',
                        finish: terminalError(
                            'native-stream-incomplete',
                            'The native model provider stream ended without a terminal event.'
                        ),
                    };
                }
                return { status: 'available', finish: terminal({ reason: finishReason }) };
            } else {
                const prompts = readPrompts(input.request);
                if (prompts === null) {
                    return {
                        status: 'available',
                        finish: terminalError(
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
                emit({ type: 'text', mode: 'cumulative-snapshot', text });
            }
            return { status: 'available', finish: terminal({ reason: 'stop' }) };
        }

        const prompts = readPrompts(input.request);
        if (prompts === null) {
            return {
                status: 'available',
                finish: terminalError(
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
                    finish: terminalError(
                        'native-tools-unavailable',
                        'The native model provider could not produce structured tool calls.'
                    ),
                };
            }
            for (const [index, call] of toolCalls.entries()) {
                emit({
                    type: 'tool-call',
                    call: {
                        id: call.id ?? `${input.request.correlationId}:${String(index)}`,
                        name: call.name,
                        arguments: call.arguments,
                    },
                });
            }
            return { status: 'available', finish: terminal({ reason: 'stop' }) };
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
                finish: terminalError(
                    'native-structured-output-unavailable',
                    'The native model provider could not produce structured output.'
                ),
            };
        }
        emit({ type: 'structured-output', value: parseStructuredOutput(serialized) });
        return { status: 'available', finish: terminal({ reason: 'stop' }) };
    } catch (error) {
        if (isToolPlanningRejectedError(error)) {
            return {
                status: 'available',
                finish: terminalError('tool-planning-rejected', error.message, false),
            };
        }
        if (isNativeToolCallingProtocolError(error)) {
            return {
                status: 'available',
                finish: terminalError(
                    'native-tool-protocol-invalid',
                    'The native model provider returned an invalid tool response.'
                ),
            };
        }
        if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            return { status: 'available', finish: terminal({ reason: 'cancelled' }) };
        }
        const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || /timed out/i.test(error.message));
        const isLength = error instanceof Error && /finish reason length/i.test(error.message);
        if (isLength) {
            return { status: 'available', finish: terminal({ reason: 'length' }) };
        }
        return {
            status: 'available',
            finish: terminalError(
                isTimeout ? 'native-provider-timeout' : 'native-provider-failed',
                isTimeout ? 'The native model provider request timed out.' : 'The native model provider request failed.'
            ),
        };
    }
}
