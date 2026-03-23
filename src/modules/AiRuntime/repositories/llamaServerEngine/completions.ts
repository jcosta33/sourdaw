import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';
import { BASE_URL } from './lifecycle';

/**
 * Non-streaming completion via the llama-server.
 * In Tauri: proxied through Rust to avoid CSP issues.
 * In browser dev mode: direct fetch to localhost.
 */
export async function generateNativeCompletion(systemPrompt: string, userMessage: string): Promise<string> {
    if (isTauri()) {
        return (await tauriInvoke('generate_llm_completion', {
            request: {
                system_prompt: systemPrompt,
                user_message: userMessage,
                temperature: 0.1,
                max_tokens: 1024,
            },
        })) as string;
    }

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.1,
            max_tokens: 1024,
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
