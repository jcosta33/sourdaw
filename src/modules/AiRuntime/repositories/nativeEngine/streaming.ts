import { isTauri, tauriInvoke, createChannel } from '#/utils/tauriBridge';

import { BASE_URL } from './lifecycle';

type LlmStreamEvent =
    | { event: 'token'; data: { text: string } }
    | { event: 'done'; data: { totalTokens: number } }
    | { event: 'error'; data: { message: string } };

/**
 * Streaming completion.
 * In Tauri: in-process streaming via mistral.rs + Tauri Channel.
 * In browser dev mode: SSE from localhost llama-server.
 */
export async function streamNativeCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
    if (isTauri()) {
        const channel = await createChannel<LlmStreamEvent>();

        // Errors thrown inside onmessage (a synchronous callback) do not propagate
        // to the awaiting tauriInvoke call — capture and rethrow after the invoke.
        let streamError: Error | null = null;
        channel.onmessage = (event: LlmStreamEvent) => {
            if (event.event === 'token') {
                onToken(event.data.text);
            }
            if (event.event === 'error') {
                streamError = new Error(event.data.message);
            }
        };

        const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
        const nonSystemMessages = messages.filter((message) => message.role !== 'system');

        await tauriInvoke('stream_native_completion', {
            systemPrompt,
            messages: nonSystemMessages,
            temperature: options?.temperature ?? 0.7,
            maxTokens: options?.maxTokens ?? 2048,
            onEvent: channel,
        });

        if (streamError) {
            throw streamError;
        }
        return;
    }

    // Browser dev mode: SSE from llama-server
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 2048,
            seed: 0,
            stream: true,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`llama-server error ${String(response.status)}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) {
                continue;
            }
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') {
                return;
            }
            try {
                const chunk = JSON.parse(jsonStr) as { choices: Array<{ delta: { content?: string } }> };
                const content = chunk.choices[0]?.delta.content;
                if (content) {
                    onToken(content);
                }
            } catch {
                // Skip malformed SSE chunks
            }
        }
    }
}
