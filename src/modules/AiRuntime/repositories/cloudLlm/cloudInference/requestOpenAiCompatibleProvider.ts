import { normalizeProviderCapabilityProbe } from '../../normalizeProviderCapabilityProbe';
import { type CompiledProviderAdapter } from '../../providerAdapterRegistry';
import { runProviderGatewayRequest } from '../../providerGateway';
import { type OpenAiCompatibleCloudRuntime } from '../cloudSession';

type RequestOpenAiCompatibleProviderInput = {
    runtime: OpenAiCompatibleCloudRuntime;
    body: string;
    signal: AbortSignal;
    onBodyChunk: (chunk: Uint8Array) => void;
};

export type OpenAiCompatibleProviderResponse = {
    status: number;
    contentType: string | null;
};

const verifiedAdapters = new WeakSet<CompiledProviderAdapter>();
const MAX_PROVIDER_REQUEST_BYTES = 1_024 * 1_024;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1_024 * 1_024;

function addBoundedResponseBytes(current: number, chunk: Uint8Array): number {
    const next = current + chunk.byteLength;
    if (!Number.isSafeInteger(next) || next > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error('Hosted provider response exceeds its 8 MiB limit');
    }
    return next;
}

async function ensureAdapterCapabilities(
    adapter: CompiledProviderAdapter,
    sessionId: string,
    signal: AbortSignal
): Promise<void> {
    if (verifiedAdapters.has(adapter)) {
        return;
    }
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
    let payload: unknown;
    try {
        payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw new Error('Provider adapter capability probe returned invalid JSON');
    }
    normalizeProviderCapabilityProbe(adapter, payload);
    verifiedAdapters.add(adapter);
}

export async function requestOpenAiCompatibleProvider({
    runtime,
    body,
    signal,
    onBodyChunk,
}: RequestOpenAiCompatibleProviderInput): Promise<OpenAiCompatibleProviderResponse> {
    if (new TextEncoder().encode(body).byteLength > MAX_PROVIDER_REQUEST_BYTES) {
        throw new Error('Hosted provider request exceeds its 1 MiB limit');
    }
    if (runtime.adapter) {
        if (runtime.session_id === null) {
            throw new Error('Hosted provider credential session is unavailable');
        }
        await ensureAdapterCapabilities(runtime.adapter, runtime.session_id, signal);
        let responseStatus = 0;
        let responseContentType: string | null = null;
        const bufferedChunks: Uint8Array[] = [];
        await runProviderGatewayRequest({
            requestId: crypto.randomUUID(),
            sessionId: runtime.session_id,
            operation: 'request',
            body,
            signal,
            onResponseStart: (value) => {
                responseStatus = value.status;
                responseContentType = value.contentType;
            },
            onBodyChunk: (chunk) => {
                if (responseStatus >= 200 && responseStatus < 300) {
                    onBodyChunk(chunk);
                } else {
                    bufferedChunks.push(chunk);
                }
            },
        });
        if (responseStatus === 0) {
            throw new Error('Provider gateway completed without a response envelope');
        }
        if (responseStatus >= 200 && responseStatus < 300) {
            for (const chunk of bufferedChunks) {
                onBodyChunk(chunk);
            }
        }
        return { status: responseStatus, contentType: responseContentType };
    }

    const response = await fetch(`${runtime.base_url}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
    } else if (response.body) {
        const reader = response.body.getReader();
        let responseBytes = 0;
        try {
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                responseBytes = addBoundedResponseBytes(responseBytes, chunk.value);
                onBodyChunk(chunk.value);
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
    }
    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
    };
}
