import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { assertRemoteAgentDataPolicy } from '../models/AgentDataPolicy';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderMessage,
    type ModelProviderResult,
} from '../models/ModelProviderProtocol';
import { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { getCloudProviderInfo } from '../repositories/cloudLlm/getCloudProviderInfo';

import { createModelProviderStreamWriter } from './createModelProviderStreamWriter';
import { createModelProviderProtocol } from './modelProviderProtocol';

type StreamHostedModelTextInput = {
    correlationId: string;
    runId?: string;
    requestId?: string;
    cancellationGeneration?: number;
    messages: ModelProviderMessage[];
    maxOutputTokens: number;
    temperature?: number;
    onToken: (text: string) => void;
    signal?: AbortSignal;
};

function unavailableResult(input: StreamHostedModelTextInput): ModelProviderResult {
    return {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        provider: 'openai-compatible',
        model: null,
        correlationId: input.correlationId,
        status: 'unavailable',
        output: { text: '', reasoning: '', toolCalls: [], structuredOutput: null },
        usage: {
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'unavailable',
        },
        finishReason: 'unavailable',
        partialOutputDisposition: 'none',
        failure: {
            code: 'hosted-provider-unavailable',
            correlationId: input.correlationId,
            retryable: true,
            safeMessage: 'The hosted model provider is not configured.',
            partialOutputDisposition: 'none',
        },
        ignoredProviderEvents: [],
    };
}

export async function streamHostedModelText(input: StreamHostedModelTextInput): Promise<ModelProviderResult> {
    const providerInfo = getCloudProviderInfo();
    if (providerInfo === null) {
        return unavailableResult(input);
    }
    assertRemoteAgentDataPolicy(['system-instructions', 'prompt-text', 'metadata']);

    const protocol = createModelProviderProtocol({
        provider: providerInfo.provider,
        model: providerInfo.model,
    });
    const compiled = protocol.compileRequest({
        correlationId: input.correlationId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.cancellationGeneration === undefined ? {} : { cancellationGeneration: input.cancellationGeneration }),
        operation: 'text',
        modality: 'text',
        messages: input.messages,
        stream: true,
        limits: { maxOutputTokens: input.maxOutputTokens },
        controls: { cache: 'provider-default', reasoning: 'provider-default' },
        budget: {
            maxInputTokens: 32_768,
            maxOutputTokens: input.maxOutputTokens,
            maxTotalTokens: 32_768 + input.maxOutputTokens,
        },
        dataPolicy: 'remote-allowed',
    });
    if (compiled.status === 'unavailable') {
        return {
            ...unavailableResult(input),
            provider: providerInfo.provider,
            model: providerInfo.model,
            failure: compiled.failure,
        };
    }

    const session = protocol.start(compiled.request);
    const writer = createModelProviderStreamWriter(compiled.request, session);
    try {
        const outcome = await streamCloudChatCompletion(
            compiled.request.messages,
            (text) => {
                writer.push({ type: 'text', mode: 'delta', text });
                input.onToken(text);
            },
            {
                maxTokens: compiled.request.limits.maxOutputTokens,
                temperature: input.temperature,
                signal: input.signal,
                onUsage: (event) => writer.push(event),
                onUnknownEvent: (providerEventType) => writer.push({ type: 'unknown', providerEventType }),
            }
        );
        if (outcome.status === 'complete') {
            return writer.finish({ reason: 'stop' });
        }
        if (outcome.reason === 'token limit' || outcome.reason === 'max_tokens' || outcome.reason === 'length') {
            return writer.finish({ reason: 'length' });
        }
        return writer.finish({
            reason: 'error',
            failure: {
                code: 'hosted-provider-incomplete',
                retryable: true,
                safeMessage: 'The hosted model provider returned an incomplete response.',
            },
        });
    } catch (error) {
        if (
            input.signal?.aborted ||
            isAiRuntimeConfigurationChangedError(error) ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            return writer.finish({ reason: 'cancelled' });
        }
        return writer.finish({
            reason: 'error',
            failure: {
                code: 'hosted-provider-failed',
                retryable: true,
                safeMessage: 'The hosted model provider request failed.',
            },
        });
    }
}
