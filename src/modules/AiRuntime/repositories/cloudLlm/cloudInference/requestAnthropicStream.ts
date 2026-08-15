const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MAX_ANTHROPIC_EVENT_BYTES = 64 * 1_024;
const MAX_ANTHROPIC_REQUEST_BYTES = 1_024 * 1_024;
const MAX_ANTHROPIC_RESPONSE_BYTES = 1_024 * 1_024;
const MAX_ANTHROPIC_STREAM_EVENTS = 4_096;

type RequestAnthropicStreamInput = {
    apiKey: string;
    model: string;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens: number;
    signal: AbortSignal;
};

function encodedBytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

async function cancelResponseBody(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
}

export async function* requestAnthropicStream({
    apiKey,
    model,
    system,
    messages,
    maxTokens,
    signal,
}: RequestAnthropicStreamInput): AsyncGenerator<unknown> {
    const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true });
    if (encodedBytes(body) > MAX_ANTHROPIC_REQUEST_BYTES) {
        throw new Error('Hosted AI chat request exceeded its size limit');
    }
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
            accept: 'text/event-stream',
            'anthropic-dangerous-direct-browser-access': 'true',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body,
        signal,
    });
    if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error(`Hosted AI chat request failed with status ${String(response.status)}`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_ANTHROPIC_RESPONSE_BYTES) {
        await cancelResponseBody(response);
        throw new Error('Hosted AI chat response exceeded its size limit');
    }
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Hosted AI chat response did not include a stream');
    }

    const decoder = new TextDecoder();
    let rawBytes = 0;
    let lineBuffer = '';
    let eventDataLines: string[] = [];
    let eventDataBytes = 0;
    let eventCount = 0;
    let responseExhausted = false;

    const finishEvent = (): unknown[] => {
        if (eventDataLines.length === 0) {
            return [];
        }
        eventCount += 1;
        if (eventCount > MAX_ANTHROPIC_STREAM_EVENTS || eventDataBytes > MAX_ANTHROPIC_EVENT_BYTES) {
            throw new Error('Hosted AI chat stream exceeded its event limit');
        }
        const data = eventDataLines.join('\n');
        eventDataLines = [];
        eventDataBytes = 0;
        try {
            return [JSON.parse(data) as unknown];
        } catch {
            throw new Error('Hosted AI chat stream returned invalid event JSON');
        }
    };
    const consumeLine = (line: string): unknown[] => {
        const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
        if (normalized.length === 0) {
            return finishEvent();
        }
        if (!normalized.startsWith('data:')) {
            return [];
        }
        const data = normalized.slice(5).replace(/^ /, '');
        const nextBytes = encodedBytes(data) + (eventDataLines.length === 0 ? 0 : 1);
        eventDataBytes += nextBytes;
        if (eventDataBytes > MAX_ANTHROPIC_EVENT_BYTES) {
            throw new Error('Hosted AI chat stream exceeded its event payload limit');
        }
        eventDataLines.push(data);
        return [];
    };
    const consumeDecoded = (flush: boolean): unknown[] => {
        const events: unknown[] = [];
        let newline = lineBuffer.indexOf('\n');
        while (newline >= 0) {
            events.push(...consumeLine(lineBuffer.slice(0, newline)));
            lineBuffer = lineBuffer.slice(newline + 1);
            newline = lineBuffer.indexOf('\n');
        }
        if (encodedBytes(lineBuffer) > MAX_ANTHROPIC_EVENT_BYTES) {
            throw new Error('Hosted AI chat stream exceeded its event payload limit');
        }
        if (flush) {
            if (lineBuffer.length > 0) {
                events.push(...consumeLine(lineBuffer));
                lineBuffer = '';
            }
            events.push(...finishEvent());
        }
        return events;
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                responseExhausted = true;
                break;
            }
            rawBytes += value.byteLength;
            if (rawBytes > MAX_ANTHROPIC_RESPONSE_BYTES) {
                throw new Error('Hosted AI chat response exceeded its size limit');
            }
            lineBuffer += decoder.decode(value, { stream: true });
            for (const event of consumeDecoded(false)) {
                yield event;
            }
        }
        lineBuffer += decoder.decode();
        for (const event of consumeDecoded(true)) {
            yield event;
        }
    } finally {
        if (!responseExhausted) {
            await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
    }
}
