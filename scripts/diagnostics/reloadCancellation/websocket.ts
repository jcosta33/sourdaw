import { createHash } from 'node:crypto';

import { recordOf, requiredText, type RecordObservation } from './journal.ts';

export const WEBSOCKET_EVENTS = [
    'Network.webSocketCreated',
    'Network.webSocketWillSendHandshakeRequest',
    'Network.webSocketHandshakeResponseReceived',
    'Network.webSocketFrameError',
    'Network.webSocketClosed',
    'Network.webSocketFrameSent',
    'Network.webSocketFrameReceived',
] as const;

function finite(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be finite`);
    }
    return value;
}

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function sanitizedUrl(value: unknown): string {
    const url = new URL(requiredText(value, 'url'));
    for (const key of [...url.searchParams.keys()]) {
        url.searchParams.set(key, '<redacted>');
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
}

function frameSummary(value: unknown): Record<string, unknown> {
    const frame = recordOf(value, 'frame');
    const opcode = finite(frame.opcode, 'opcode');
    if (!Number.isInteger(opcode) || opcode < 0 || opcode > 15 || typeof frame.mask !== 'boolean') {
        throw new TypeError('Invalid websocket opcode or mask');
    }
    if (typeof frame.payloadData !== 'string') {
        throw new TypeError('Missing websocket payloadData');
    }
    let messageType: unknown;
    if (opcode === 1) {
        try {
            const parsed: unknown = JSON.parse(frame.payloadData);
            const type = recordOf(parsed, 'text message').type;
            if (['connected', 'update', 'full-reload', 'custom', 'error', 'ping', 'prune'].includes(String(type))) {
                messageType = type;
            }
        } catch {
            // Arbitrary text is valid websocket data, not a collector failure.
        }
    }
    return {
        opcode,
        mask: frame.mask,
        characters: frame.payloadData.length,
        sha256: digest(frame.payloadData),
        messageType,
    };
}

export function summarizeWebSocket(name: string, payload: unknown): Record<string, unknown> {
    if (!WEBSOCKET_EVENTS.some((event) => event === name)) {
        throw new TypeError('Unsupported websocket event');
    }
    const event = recordOf(payload, 'websocket event');
    const result: Record<string, unknown> = { event: name, requestId: requiredText(event.requestId, 'requestId') };
    if (name === 'Network.webSocketCreated') {
        return { ...result, url: sanitizedUrl(event.url), classification: 'created' };
    }
    result.timestamp = finite(event.timestamp, 'timestamp');
    if (name === 'Network.webSocketWillSendHandshakeRequest') {
        const request = recordOf(event.request, 'request');
        return {
            ...result,
            wallTime: finite(event.wallTime, 'wallTime'),
            headerNames: Object.keys(recordOf(request.headers, 'headers')),
        };
    }
    if (name === 'Network.webSocketHandshakeResponseReceived') {
        const response = recordOf(event.response, 'response');
        const status = finite(response.status, 'status');
        return {
            ...result,
            status,
            headerNames: Object.keys(recordOf(response.headers, 'headers')),
            classification: status === 101 ? 'upgraded' : 'handshake-not-upgraded',
        };
    }
    if (name === 'Network.webSocketFrameError') {
        const message = requiredText(event.errorMessage, 'errorMessage');
        return {
            ...result,
            classification: 'socket-error-observed',
            characters: message.length,
            sha256: digest(message),
        };
    }
    if (name === 'Network.webSocketClosed') {
        return { ...result, classification: 'socket-close-observed' };
    }
    const frame = frameSummary(event.response);
    return { ...result, frame, classification: frame.opcode === 8 ? 'close-frame-observed' : 'frame-observed' };
}

export function createWebSocketObserver(record: RecordObservation): {
    observe: (name: string, payload: unknown) => void;
    health: () => { errors: string[]; missingCreation: string[]; created: number };
} {
    const created = new Set<string>();
    const errors: string[] = [];
    const missingCreation = new Set<string>();
    return {
        observe(name, payload) {
            record('websocket-raw', { name, payload });
            try {
                const summary = summarizeWebSocket(name, payload);
                const id = requiredText(summary.requestId, 'requestId');
                if (name === 'Network.webSocketCreated') {
                    created.add(id);
                }
                if (!created.has(id)) {
                    missingCreation.add(id);
                }
                record('websocket-summary', summary);
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
                record('websocket-collector-error', { event: name, message: errors.at(-1) });
            }
        },
        health: () => ({ errors: [...errors], missingCreation: [...missingCreation], created: created.size }),
    };
}
