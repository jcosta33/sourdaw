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

async function ensureAdapterCapabilities(
    adapter: CompiledProviderAdapter,
    apiKey: string,
    signal: AbortSignal
): Promise<void> {
    if (verifiedAdapters.has(adapter)) {
        return;
    }
    const chunks: Uint8Array[] = [];
    let status: number | null = null;
    await runProviderGatewayRequest({
        requestId: crypto.randomUUID(),
        adapter,
        operation: 'probe',
        apiKey,
        body: null,
        signal,
        onResponseStart: (response) => {
            status = response.status;
        },
        onBodyChunk: (chunk) => chunks.push(chunk),
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
    if (runtime.adapter) {
        await ensureAdapterCapabilities(runtime.adapter, runtime.api_key, signal);
        let responseStatus = 0;
        let responseContentType: string | null = null;
        const bufferedChunks: Uint8Array[] = [];
        await runProviderGatewayRequest({
            requestId: crypto.randomUUID(),
            adapter: runtime.adapter,
            operation: 'request',
            apiKey: runtime.api_key,
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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (runtime.api_key) {
        headers.Authorization = `Bearer ${runtime.api_key}`;
    }
    const response = await fetch(`${runtime.base_url}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body,
    });
    if (response.ok && response.body) {
        const reader = response.body.getReader();
        try {
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
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
