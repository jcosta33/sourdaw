import { type OpenAiCompatibleCloudRuntime } from '../cloudSession';

type StreamOpenAiCompatibleChatCompletionInput = {
    runtime: OpenAiCompatibleCloudRuntime;
    messages: Array<{ role: string; content: string }>;
    onToken: (text: string) => void;
    signal: AbortSignal;
    maxTokens?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ParsedStreamEvent = {
    text: string | null;
    finishReason: string | null;
};

export type OpenAiCompatibleFinishReason = 'stop' | 'length';

type StreamState = {
    finishReason: OpenAiCompatibleFinishReason | null;
};

function parseStreamEvent(event: unknown): ParsedStreamEvent {
    if (!isRecord(event) || !Array.isArray(event.choices)) {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    if ('error' in event || event.choices.length === 0) {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const choices: unknown[] = event.choices;
    const firstChoice = choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
        throw new Error('Hosted AI returned an invalid streaming event');
    }

    const content = firstChoice.delta.content;
    if (content !== undefined && content !== null && typeof content !== 'string') {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const finishReason = firstChoice.finish_reason;
    if (finishReason !== undefined && finishReason !== null && typeof finishReason !== 'string') {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    if (firstChoice.delta.refusal !== undefined && firstChoice.delta.refusal !== null) {
        throw new Error('Hosted AI refused the chat request');
    }

    return {
        text: typeof content === 'string' ? content : null,
        finishReason: typeof finishReason === 'string' ? finishReason : null,
    };
}

function emitEventData(
    data: string,
    onToken: (text: string) => void,
    state: StreamState
): OpenAiCompatibleFinishReason | null {
    if (data === '[DONE]') {
        if (state.finishReason === null) {
            throw new Error('Hosted AI chat stream ended before normal completion');
        }
        return state.finishReason;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(data) as unknown;
    } catch {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const event = parseStreamEvent(parsed);
    if (event.finishReason !== null) {
        if (event.finishReason !== 'stop' && event.finishReason !== 'length') {
            throw new Error('Hosted AI chat stream ended before normal completion');
        }
        state.finishReason = event.finishReason;
    }
    if (event.text !== null) {
        onToken(event.text);
    }
    return null;
}

export async function streamOpenAiCompatibleChatCompletion({
    runtime,
    messages,
    onToken,
    signal,
    maxTokens,
}: StreamOpenAiCompatibleChatCompletionInput): Promise<OpenAiCompatibleFinishReason> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (runtime.api_key) {
        headers.Authorization = `Bearer ${runtime.api_key}`;
    }

    const response = await fetch(`${runtime.base_url}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
            model: runtime.model,
            messages: messages.filter(
                (message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant'
            ),
            max_tokens: maxTokens ?? 2048,
            stream: true,
        }),
    });

    if (!response.ok) {
        throw new Error(`Hosted AI chat request failed with status ${String(response.status)}`);
    }
    if (!response.body) {
        throw new Error('Hosted AI chat response did not include a stream');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamEnded = false;
    const streamState: StreamState = { finishReason: null };

    try {
        while (!streamEnded) {
            const chunk = await reader.read();
            streamEnded = chunk.done;
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data:')) {
                    continue;
                }
                const finishReason = emitEventData(line.slice(5).trim(), onToken, streamState);
                if (finishReason !== null) {
                    await reader.cancel();
                    return finishReason;
                }
            }
        }

        const finalLine = buffer.trim();
        if (finalLine.startsWith('data:')) {
            const finishReason = emitEventData(finalLine.slice(5).trim(), onToken, streamState);
            if (finishReason !== null) {
                await reader.cancel();
                return finishReason;
            }
        }

        throw new Error('Hosted AI chat stream ended unexpectedly');
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
}
