import { runProviderGatewayRequest } from '../../providerGateway';

const MAX_ANTHROPIC_REQUEST_BYTES = 1024 * 1024;

type RequestAnthropicProviderInput = {
    sessionId: string;
    body: string;
    signal: AbortSignal;
    onBodyChunk: (chunk: Uint8Array) => void;
};

export async function requestAnthropicProvider({
    sessionId,
    body,
    signal,
    onBodyChunk,
}: RequestAnthropicProviderInput): Promise<{ status: number; contentType: string | null }> {
    if (new TextEncoder().encode(body).byteLength > MAX_ANTHROPIC_REQUEST_BYTES) {
        throw new Error('Hosted AI request exceeded its size limit');
    }
    let status = 0;
    let contentType: string | null = null;
    await runProviderGatewayRequest({
        requestId: crypto.randomUUID(),
        sessionId,
        operation: 'request',
        body,
        signal,
        onResponseStart: (response) => {
            status = response.status;
            contentType = response.contentType;
        },
        onBodyChunk: (chunk) => {
            if (status >= 200 && status < 300) {
                onBodyChunk(chunk);
            }
        },
    });
    return { status, contentType };
}
