import { WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { generateWebLlmCompletion as generateWebCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';

import { runLocalModelTextCompletion } from './runLocalModelTextCompletion';

export async function generateWebLlmCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
    return runLocalModelTextCompletion({
        provider: 'webllm',
        model: WEBLLM_MODEL_ID,
        systemPrompt,
        userMessage,
        maxOutputTokens: options?.maxTokens ?? 2_048,
        signal: options?.signal,
        execute: (compiledSystemPrompt, compiledUserMessage) =>
            generateWebCompletion(compiledSystemPrompt, compiledUserMessage, options),
    });
}
