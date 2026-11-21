import { NoLocalModelOfferedError } from '../../errors/NoLocalModelOfferedError';
import { generateWebLlmCompletion as generateWebCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';

import { resolveLocalModelToAutoLoad } from './resolveLocalModelToAutoLoad';
import { runLocalModelTextCompletion } from './runLocalModelTextCompletion';

export async function generateWebLlmCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
    const modelId = resolveLocalModelToAutoLoad();
    if (modelId === null) {
        throw new NoLocalModelOfferedError();
    }
    return runLocalModelTextCompletion({
        provider: 'webllm',
        model: modelId,
        systemPrompt,
        userMessage,
        maxOutputTokens: options?.maxTokens ?? 2_048,
        signal: options?.signal,
        execute: (compiledSystemPrompt, compiledUserMessage) =>
            generateWebCompletion(compiledSystemPrompt, compiledUserMessage, { ...options, modelId }),
    });
}
