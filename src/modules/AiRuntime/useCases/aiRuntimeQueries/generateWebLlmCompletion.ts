import { generateWebLlmCompletion as generateWebCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';

export async function generateWebLlmCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
    return await generateWebCompletion(systemPrompt, userMessage, options);
}
