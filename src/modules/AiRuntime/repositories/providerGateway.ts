import { createChannel, tauriInvoke, type TauriChannel } from '#/utils/tauriBridge';

import { type CompiledProviderAdapter } from './providerAdapterRegistry';

const MAX_PROVIDER_REQUEST_BYTES = 1024 * 1024;

type ProviderGatewayWireEvent =
    | { event: 'response-start'; data: { status: number; contentType: string | null } }
    | { event: 'body-chunk'; data: { bytes: number[] } }
    | { event: 'done'; data: Record<string, never> };

export type ProviderGatewayResponseStart = {
    status: number;
    contentType: string | null;
};

export type ProviderGatewayRequest = {
    requestId: string;
    adapter: CompiledProviderAdapter;
    operation: 'probe' | 'request';
    apiKey: string;
    body: string | null;
    signal: AbortSignal;
    onResponseStart: (response: ProviderGatewayResponseStart) => void;
    onBodyChunk: (chunk: Uint8Array) => void;
};

export type ProviderGatewayDependencies = {
    createChannel: <Payload>() => Promise<TauriChannel<Payload>>;
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const productionDependencies: ProviderGatewayDependencies = {
    createChannel,
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
        return tauriInvoke(command, args);
    },
};

function assertRequestId(value: string): void {
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) {
        throw new Error('Provider gateway request ID is invalid');
    }
}

function parseWireEvent(
    event: ProviderGatewayWireEvent,
    onResponseStart: ProviderGatewayRequest['onResponseStart'],
    onBodyChunk: ProviderGatewayRequest['onBodyChunk']
): void {
    if (event.event === 'response-start') {
        if (
            !Number.isInteger(event.data.status) ||
            event.data.status < 100 ||
            event.data.status > 599 ||
            (event.data.contentType !== null && typeof event.data.contentType !== 'string')
        ) {
            throw new Error('Provider gateway returned an invalid response envelope');
        }
        onResponseStart({ status: event.data.status, contentType: event.data.contentType });
        return;
    }
    if (event.event === 'body-chunk') {
        if (
            !Array.isArray(event.data.bytes) ||
            event.data.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
        ) {
            throw new Error('Provider gateway returned an invalid body chunk');
        }
        onBodyChunk(Uint8Array.from(event.data.bytes));
        return;
    }
    if (event.event !== 'done') {
        throw new Error('Provider gateway returned an unknown event');
    }
}

export async function runProviderGatewayRequest(
    request: ProviderGatewayRequest,
    dependencies: ProviderGatewayDependencies = productionDependencies
): Promise<void> {
    assertRequestId(request.requestId);
    request.signal.throwIfAborted();
    if (request.body !== null && new TextEncoder().encode(request.body).byteLength > MAX_PROVIDER_REQUEST_BYTES) {
        throw new Error('Provider gateway request exceeds the 1 MiB body limit');
    }

    const channel = await dependencies.createChannel<ProviderGatewayWireEvent>();
    request.signal.throwIfAborted();
    let eventError: unknown = null;
    let acceptsEvents = true;
    channel.onmessage = (event) => {
        if (!acceptsEvents || request.signal.aborted || eventError !== null) {
            return;
        }
        try {
            parseWireEvent(event, request.onResponseStart, request.onBodyChunk);
        } catch (error) {
            eventError = error;
        }
    };

    const cancel = (): void => {
        void dependencies.invoke('cancel_provider_gateway_request', { requestId: request.requestId });
    };
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
        await dependencies.invoke('provider_gateway_request', {
            requestId: request.requestId,
            adapterId: request.adapter.adapterId,
            origin: request.adapter.origin,
            operation: request.operation,
            apiKey: request.apiKey,
            body: request.body,
            onEvent: channel,
        });
        request.signal.throwIfAborted();
        if (eventError !== null) {
            if (eventError instanceof Error) {
                throw eventError;
            }
            throw new Error('Provider gateway event handling failed');
        }
    } finally {
        acceptsEvents = false;
        channel.onmessage = () => undefined;
        request.signal.removeEventListener('abort', cancel);
    }
}
