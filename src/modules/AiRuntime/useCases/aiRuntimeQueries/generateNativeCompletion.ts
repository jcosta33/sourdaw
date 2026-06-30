import { generateNativeCompletion as generateNativeEngineCompletion } from '../../repositories/nativeEngine/completions';

export async function generateNativeCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
    return await generateNativeEngineCompletion(systemPrompt, userMessage, options);
}
