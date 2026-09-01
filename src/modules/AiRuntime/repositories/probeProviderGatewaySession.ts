import { runProviderGatewayRequest } from './providerGateway';

const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;

function addBoundedResponseBytes(current: number, chunk: Uint8Array): number {
    const next = current + chunk.byteLength;
    if (!Number.isSafeInteger(next) || next > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error('Hosted provider response exceeds its 8 MiB limit');
    }
    return next;
}

export async function probeProviderGatewaySession(sessionId: string, signal: AbortSignal): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let responseBytes = 0;
    let status: number | null = null;
    await runProviderGatewayRequest({
        requestId: crypto.randomUUID(),
        sessionId,
        operation: 'probe',
        body: null,
        signal,
        onResponseStart: (response) => {
            status = response.status;
        },
        onBodyChunk: (chunk) => {
            responseBytes = addBoundedResponseBytes(responseBytes, chunk);
            chunks.push(chunk);
        },
    });
    if (status === null || status < 200 || status >= 300) {
        throw new Error(`Provider adapter capability probe failed with status ${String(status ?? 'unknown')}`);
    }
    const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
