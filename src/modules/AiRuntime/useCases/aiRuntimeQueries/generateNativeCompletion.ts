import { runNativeModelProviderRequest } from '../../repositories/nativeModelProviderAdapter';

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
        executeRequest: (request, onEvent) =>
            runNativeModelProviderRequest({
                request,
                onEvent,
                ...(options?.signal === undefined ? {} : { signal: options.signal }),
            }),
    });
}
