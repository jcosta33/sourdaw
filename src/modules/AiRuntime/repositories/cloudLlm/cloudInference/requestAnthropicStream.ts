import { requestAnthropicProvider } from './requestAnthropicProvider';

const MAX_ANTHROPIC_EVENT_BYTES = 64 * 1024;
const MAX_ANTHROPIC_RESPONSE_BYTES = 1024 * 1024;
const MAX_ANTHROPIC_STREAM_EVENTS = 4096;

type RequestAnthropicStreamInput = {
    sessionId: string;
    model: string;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens: number;
    signal: AbortSignal;
    onEvent: (event: unknown) => void;
};

function encodedBytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

export async function requestAnthropicStream({
    sessionId,
    model,
    system,
    messages,
    maxTokens,
    signal,
    onEvent,
}: RequestAnthropicStreamInput): Promise<void> {
    const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true });
    const decoder = new TextDecoder();
    let rawBytes = 0;
    let lineBuffer = '';
    let eventDataLines: string[] = [];
    let eventDataBytes = 0;
    let eventCount = 0;

    const finishEvent = (): void => {
        if (eventDataLines.length === 0) {
            return;
        }
        eventCount += 1;
        if (eventCount > MAX_ANTHROPIC_STREAM_EVENTS || eventDataBytes > MAX_ANTHROPIC_EVENT_BYTES) {
            throw new Error('Hosted AI chat stream exceeded its event limit');
        }
        const data = eventDataLines.join('\n');
        eventDataLines = [];
        eventDataBytes = 0;
        try {
            onEvent(JSON.parse(data) as unknown);
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new TypeError('Hosted AI chat stream returned invalid event JSON', { cause: error });
            }
            throw error;
        }
    };
    const consumeLine = (line: string): void => {
        const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
        if (normalized.length === 0) {
            finishEvent();
            return;
        }
        if (!normalized.startsWith('data:')) {
            return;
        }
        const data = normalized.slice(5).replace(/^ /u, '');
        eventDataBytes += encodedBytes(data) + (eventDataLines.length === 0 ? 0 : 1);
        if (eventDataBytes > MAX_ANTHROPIC_EVENT_BYTES) {
            throw new Error('Hosted AI chat stream exceeded its event payload limit');
        }
        eventDataLines.push(data);
    };
    const consumeDecoded = (flush: boolean): void => {
        let newline = lineBuffer.indexOf('\n');
        while (newline >= 0) {
            consumeLine(lineBuffer.slice(0, newline));
            lineBuffer = lineBuffer.slice(newline + 1);
            newline = lineBuffer.indexOf('\n');
        }
        if (encodedBytes(lineBuffer) > MAX_ANTHROPIC_EVENT_BYTES) {
            throw new Error('Hosted AI chat stream exceeded its event payload limit');
        }
        if (flush) {
            if (lineBuffer.length > 0) {
                consumeLine(lineBuffer);
                lineBuffer = '';
            }
            finishEvent();
        }
    };

    const response = await requestAnthropicProvider({
        sessionId,
        body,
        signal,
        onBodyChunk: (chunk) => {
            rawBytes += chunk.byteLength;
            if (rawBytes > MAX_ANTHROPIC_RESPONSE_BYTES) {
                throw new Error('Hosted AI chat response exceeded its size limit');
            }
            lineBuffer += decoder.decode(chunk, { stream: true });
            consumeDecoded(false);
        },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Hosted AI chat request failed with status ${String(response.status)}`);
    }
    if (response.contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/event-stream') {
        throw new Error('Hosted AI chat request returned an invalid content type');
    }
    lineBuffer += decoder.decode();
    consumeDecoded(true);
}
