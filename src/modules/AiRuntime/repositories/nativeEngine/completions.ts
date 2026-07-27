import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { BASE_URL } from './lifecycleState';

/**
 * Non-streaming completion.
 * In Tauri: in-process inference via mistral.rs.
 * In browser dev mode: direct fetch to localhost llama-server.
 */
export async function generateNativeCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
    if (isTauri()) {
        return (await tauriInvoke('generate_native_completion', {
            systemPrompt,
            userMessage,
            temperature: options?.temperature ?? 0.1,
            maxTokens: options?.maxTokens ?? 2048,
        })) as string;
    }

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        signal: options?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: options?.temperature ?? 0.1,
            max_tokens: options?.maxTokens ?? 2048,
            seed: 0,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`llama-server error ${String(response.status)}: ${text}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string | null } }> };
    return data.choices[0]?.message.content ?? '';
}
