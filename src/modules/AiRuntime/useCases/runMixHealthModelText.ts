import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';

import { generateWebLlmCompletion } from './aiRuntimeQueries/generateWebLlmCompletion';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { streamHostedModelText } from './streamHostedModelText';

type RunMixHealthModelTextInput = {
    correlationId: string;
    systemPrompt: string;
    userMessage: string;
    maxOutputTokens: number;
    onToken: (text: string) => void;
    signal?: AbortSignal;
};

const MIX_HEALTH_NEEDS_MODEL_MESSAGE =
    'Mix Health needs an AI model. Load the local WebLLM model in Settings > AI, or select the hosted provider there to send this analysis remotely.';

/**
 * Mix Health sends track names and measurements, so it reaches a hosted provider only when
 * the user selected one. Under Automatic it runs on an already-loaded local model and
 * otherwise fails closed; opening the dialog never starts a model download.
 */
export async function runMixHealthModelText(input: RunMixHealthModelTextInput): Promise<void> {
    const backend = resolveBackend();
    if (backend === 'cloud') {
        await streamMixHealthFromHostedProvider(input);
        return;
    }
    if (backend === 'webllm' && getLlmEngine() !== null) {
        await completeMixHealthOnLocalModel(input);
        return;
    }
    throw createAiRuntimeError(MIX_HEALTH_NEEDS_MODEL_MESSAGE);
}

async function streamMixHealthFromHostedProvider(input: RunMixHealthModelTextInput): Promise<void> {
    const outcome = await streamHostedModelText({
        correlationId: input.correlationId,
        messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userMessage },
        ],
        maxOutputTokens: input.maxOutputTokens,
        onToken: input.onToken,
        signal: input.signal,
    });
    if (outcome.status !== 'complete') {
        throw createAiRuntimeError(outcome.failure?.safeMessage ?? 'Hosted AI mix analysis did not complete.');
    }
}

async function completeMixHealthOnLocalModel(input: RunMixHealthModelTextInput): Promise<void> {
    const text = await generateWebLlmCompletion(input.systemPrompt, input.userMessage, {
        maxTokens: input.maxOutputTokens,
        signal: input.signal,
    });
    input.signal?.throwIfAborted();
    input.onToken(text);
}
