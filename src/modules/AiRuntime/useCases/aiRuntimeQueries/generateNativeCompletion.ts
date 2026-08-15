import { generateNativeCompletion as generateNativeEngineCompletion } from '../../repositories/nativeEngine/completions';

import { runLocalModelTextCompletion } from './runLocalModelTextCompletion';

export async function generateNativeCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
    return runLocalModelTextCompletion({
        provider: 'native',
        model: 'native',
        systemPrompt,
        userMessage,
        maxOutputTokens: options?.maxTokens ?? 2_048,
        signal: options?.signal,
        execute: (compiledSystemPrompt, compiledUserMessage) =>
            generateNativeEngineCompletion(compiledSystemPrompt, compiledUserMessage, options),
    });
}
