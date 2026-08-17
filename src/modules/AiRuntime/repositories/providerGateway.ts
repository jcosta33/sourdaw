import { productionProviderGatewayDependencies, type ProviderGatewayDependencies } from './providerGatewayDependencies';

const MAX_PROVIDER_REQUEST_BYTES = 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_EVENT_BYTES = 64 * 1024;
const MAX_PROVIDER_EVENTS = 256;

type ProviderGatewayWireEvent =
    | {
          event: 'response-start';
          data: { requestId: string; sequence: number; status: number; contentType: string | null };
      }
    | { event: 'body-chunk'; data: { requestId: string; sequence: number; bytes: number[] } }
    | { event: 'done'; data: { requestId: string; sequence: number } };

export type ProviderGatewayResponseStart = {
    status: number;
    contentType: string | null;
};

export type ProviderGatewayRequest = {
    requestId: string;
    sessionId: string;
    operation: 'probe' | 'request';
    body: string | null;
    signal: AbortSignal;
    onResponseStart: (response: ProviderGatewayResponseStart) => void;
    onBodyChunk: (chunk: Uint8Array) => void;
};

function assertRequestId(value: string): void {
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) {
        throw new Error('Provider gateway request ID is invalid');
    }
}

function parseWireEvent(
    event: ProviderGatewayWireEvent,
    requestId: string,
    state: { nextSequence: number; responseStarted: boolean; done: boolean; eventCount: number; responseBytes: number },
    onResponseStart: ProviderGatewayRequest['onResponseStart'],
    onBodyChunk: ProviderGatewayRequest['onBodyChunk']
): void {
    if (
        event.data.requestId !== requestId ||
        !Number.isSafeInteger(event.data.sequence) ||
        event.data.sequence !== state.nextSequence
    ) {
        throw new Error('Provider gateway returned a cross-request or out-of-order event');
    }
    if (state.done) {
        throw new Error('Provider gateway returned an event after completion');
    }
    if (state.eventCount >= MAX_PROVIDER_EVENTS) {
        throw new Error('Provider gateway returned too many events');
    }
    state.eventCount += 1;
    if (event.event === 'response-start') {
        if (
            !Number.isInteger(event.data.status) ||
            event.data.status < 100 ||
            event.data.status > 599 ||
            (event.data.contentType !== null && typeof event.data.contentType !== 'string')
        ) {
            throw new Error('Provider gateway returned an invalid response envelope');
        }
        if (state.responseStarted) {
            throw new Error('Provider gateway returned a duplicate response envelope');
        }
        state.responseStarted = true;
        state.nextSequence += 1;
        onResponseStart({ status: event.data.status, contentType: event.data.contentType });
        return;
    }
    if (event.event === 'body-chunk') {
        if (!state.responseStarted) {
            throw new Error('Provider gateway returned body data before its response envelope');
        }
        if (
            !Array.isArray(event.data.bytes) ||
            event.data.bytes.length > MAX_PROVIDER_EVENT_BYTES ||
            event.data.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
        ) {
            throw new Error('Provider gateway returned an invalid body chunk');
        }
        state.responseBytes += event.data.bytes.length;
        if (!Number.isSafeInteger(state.responseBytes) || state.responseBytes > MAX_PROVIDER_RESPONSE_BYTES) {
            throw new Error('Provider gateway response exceeds its 8 MiB limit');
        }
        state.nextSequence += 1;
        onBodyChunk(Uint8Array.from(event.data.bytes));
        return;
    }
    if (event.event !== 'done') {
        throw new Error('Provider gateway returned an unknown event');
    }
    if (!state.responseStarted) {
        throw new Error('Provider gateway completed before its response envelope');
    }
    state.done = true;
    state.nextSequence += 1;
}

export async function runProviderGatewayRequest(
    request: ProviderGatewayRequest,
    dependencies: ProviderGatewayDependencies = productionProviderGatewayDependencies
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
    let cancelRequested = false;
    const streamState = {
        nextSequence: 0,
        responseStarted: false,
        done: false,
        eventCount: 0,
        responseBytes: 0,
    };
    const cancel = (): void => {
        if (cancelRequested) {
            return;
        }
        cancelRequested = true;
        void dependencies
            .invoke('cancel_provider_gateway_request', { requestId: request.requestId })
            .catch(() => undefined);
    };
    channel.onmessage = (event) => {
        if (!acceptsEvents || request.signal.aborted || eventError !== null) {
            return;
        }
        try {
            parseWireEvent(event, request.requestId, streamState, request.onResponseStart, request.onBodyChunk);
        } catch (error) {
            eventError = error;
            acceptsEvents = false;
            cancel();
        }
    };
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
        let invokeError: { value: unknown } | null = null;
        try {
            await dependencies.invoke('provider_gateway_request', {
                requestId: request.requestId,
                sessionId: request.sessionId,
                operation: request.operation,
                body: request.body,
                onEvent: channel,
            });
        } catch (error) {
            invokeError = { value: error };
        }
        request.signal.throwIfAborted();
        if (eventError !== null) {
            if (eventError instanceof Error) {
                throw eventError;
            }
            throw new Error('Provider gateway event handling failed');
        }
        if (invokeError !== null) {
            throw invokeError.value;
        }
        if (!streamState.done) {
            throw new Error('Provider gateway completed without one terminal event');
        }
    } finally {
        acceptsEvents = false;
        channel.onmessage = () => undefined;
        request.signal.removeEventListener('abort', cancel);
    }
}
