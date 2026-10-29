import { describe, expect, it } from 'vitest';

import {
    assertSuccessfulAppCoverage,
    assertTelemetryHealth,
    telemetryOutcomes,
} from '../diagnostics/reloadCancellation/telemetry';
import {
    createWebSocketObserver,
    summarizeWebSocket,
    WEBSOCKET_EVENTS,
} from '../diagnostics/reloadCancellation/websocket';

const requestId = 'fixture-socket';
const privateValue = ['synthetic', 'private', 'fixture'].join('-');
const timestamped = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    requestId,
    timestamp: 12.5,
    ...extra,
});
const creation = (): Record<string, unknown> => ({ requestId, url: `ws://127.0.0.1:5174/?token=${privateValue}` });
const frame = (payloadData: string, opcode = 1): Record<string, unknown> =>
    timestamped({ response: { opcode, mask: false, payloadData } });

function capture(): {
    events: Array<{ kind: string; data: unknown }>;
    observer: ReturnType<typeof createWebSocketObserver>;
} {
    const events: Array<{ kind: string; data: unknown }> = [];
    return { events, observer: createWebSocketObserver((kind, data) => events.push({ kind, data })) };
}

function completeTelemetry(): Record<string, unknown> {
    return {
        counts: {
            'collector-ready': 1,
            'Network.requestWillBeSent': 2,
            'Page.frameNavigated': 1,
            'App-logpoint-installed': 1,
            'document-init': 1,
            'public-dom-transition': 1,
            'App-fulfilled': 1,
            'public-transport-visible': 1,
        },
        errors: [],
        websocket: { errors: [], missingCreation: [], created: 1 },
    };
}

describe('passive reload-cancellation evidence', () => {
    it('records all pinned websocket forms while summaries omit secret-shaped values', () => {
        const { events, observer } = capture();
        const fixtures = [
            creation(),
            timestamped({ wallTime: 100, request: { headers: { Cookie: privateValue } } }),
            timestamped({
                response: { status: 101, statusText: 'Switching Protocols', headers: { 'Set-Cookie': privateValue } },
            }),
            timestamped({ errorMessage: privateValue }),
            timestamped(),
            frame(JSON.stringify({ type: 'custom', privateValue })),
            frame(JSON.stringify({ type: 'full-reload', privateValue })),
        ];
        WEBSOCKET_EVENTS.forEach((name, index) => observer.observe(name, fixtures[index]));
        const summaries = events.filter((event) => event.kind === 'websocket-summary');
        expect(summaries).toHaveLength(7);
        expect(JSON.stringify(summaries)).not.toContain(privateValue);
        expect(JSON.stringify(events.filter((event) => event.kind === 'websocket-raw'))).toContain(privateValue);
        expect(observer.health()).toEqual({ errors: [], missingCreation: [], created: 1 });
    });

    it('does not infer server death, clean close or a close code from a socket-close event', () => {
        expect(summarizeWebSocket('Network.webSocketClosed', timestamped())).toEqual({
            event: 'Network.webSocketClosed',
            requestId,
            timestamp: 12.5,
            classification: 'socket-close-observed',
        });
    });

    it('distinguishes failed upgrade, frame error, control-close and ordinary binary data', () => {
        expect(
            summarizeWebSocket(
                'Network.webSocketHandshakeResponseReceived',
                timestamped({ response: { status: 403, headers: {} } })
            )
        ).toMatchObject({ classification: 'handshake-not-upgraded' });
        expect(
            summarizeWebSocket('Network.webSocketFrameError', timestamped({ errorMessage: 'connection failed' }))
        ).toMatchObject({ classification: 'socket-error-observed' });
        expect(
            summarizeWebSocket('Network.webSocketFrameReceived', frame(Buffer.from([3, 232]).toString('base64'), 8))
        ).toMatchObject({ classification: 'close-frame-observed', frame: { opcode: 8 } });
        expect(
            summarizeWebSocket('Network.webSocketFrameSent', frame(Buffer.from([0, 255]).toString('base64'), 2))
        ).toMatchObject({ classification: 'frame-observed', frame: { opcode: 2 } });
    });

    it('retains malformed-event errors after later valid events rather than reporting healthy', () => {
        const { observer } = capture();
        observer.observe('Network.webSocketCreated', creation());
        observer.observe('Network.webSocketFrameReceived', timestamped({ response: { opcode: 1, mask: false } }));
        observer.observe('Network.webSocketClosed', timestamped());
        expect(observer.health().errors).toHaveLength(1);
    });

    it('retains missing creation coverage after a late-created event', () => {
        const { observer } = capture();
        observer.observe('Network.webSocketClosed', timestamped());
        observer.observe('Network.webSocketCreated', creation());
        expect(observer.health().missingCreation).toEqual([requestId]);
    });

    it('rejects missing request ids, invalid timestamps and invalid frame facts', () => {
        expect(() => summarizeWebSocket('Network.webSocketClosed', { timestamp: 1 })).toThrow('requestId');
        expect(() => summarizeWebSocket('Network.webSocketClosed', timestamped({ timestamp: Number.NaN }))).toThrow(
            'timestamp'
        );
        expect(() =>
            summarizeWebSocket(
                'Network.webSocketFrameSent',
                timestamped({ response: { opcode: 1, mask: 'false', payloadData: '' } })
            )
        ).toThrow('opcode or mask');
    });

    it('accepts actual arbitrary text without falsely declaring a protocol error', () => {
        expect(summarizeWebSocket('Network.webSocketFrameReceived', frame('ordinary text'))).toMatchObject({
            classification: 'frame-observed',
        });
    });

    it('requires emitted source-bound signals rather than counting API subscription as evidence', () => {
        expect(() => assertTelemetryHealth(completeTelemetry())).not.toThrow();
        expect(() =>
            assertTelemetryHealth({
                counts: {},
                errors: [],
                websocket: { errors: [], missingCreation: [], created: 1 },
            })
        ).toThrow('not observed');
    });

    it('rejects incomplete or non-finite telemetry despite a passing child', () => {
        const missingApp = completeTelemetry();
        missingApp.counts = { 'collector-ready': 1, 'Network.requestWillBeSent': 1, 'Page.frameNavigated': 1 };
        expect(() => assertTelemetryHealth(missingApp)).toThrow('document-init');
        const invalid = completeTelemetry();
        invalid.websocket = { created: Number.NaN, errors: [], missingCreation: [] };
        expect(() => assertTelemetryHealth(invalid)).toThrow('Invalid websocket creation count');
        const incomplete = completeTelemetry();
        incomplete.websocket = { created: 1, errors: [], missingCreation: [requestId] };
        expect(() => assertTelemetryHealth(incomplete)).toThrow('incomplete');
    });

    it('keeps a missing App callback and transport visible as observed negative outcomes', () => {
        const failedLoad = completeTelemetry();
        failedLoad.counts = {
            'collector-ready': 1,
            'Network.requestWillBeSent': 2,
            'Page.frameNavigated': 1,
            'App-logpoint-installed': 1,
            'document-init': 1,
            'public-dom-transition': 1,
        };
        expect(() => assertTelemetryHealth(failedLoad)).not.toThrow();
        expect(telemetryOutcomes(failedLoad)).toEqual({
            'App-fulfilled': 'not-observed',
            'public-transport-visible': 'not-observed',
            'Network.webSocketCreated': 'observed',
        });
        expect(telemetryOutcomes(completeTelemetry())).toEqual({
            'App-fulfilled': 'observed',
            'public-transport-visible': 'observed',
            'Network.webSocketCreated': 'observed',
        });
        const unparsedApp = completeTelemetry();
        unparsedApp.counts = {
            'collector-ready': 1,
            'Network.requestWillBeSent': 2,
            'Page.frameNavigated': 1,
            'document-init': 1,
            'public-dom-transition': 1,
        };
        expect(() => assertTelemetryHealth(unparsedApp)).not.toThrow();
        expect(telemetryOutcomes(unparsedApp)).toEqual({
            'App-fulfilled': 'unknown',
            'public-transport-visible': 'not-observed',
            'Network.webSocketCreated': 'observed',
        });
        unparsedApp.websocket = { errors: [], missingCreation: [], created: 0 };
        expect(() => assertTelemetryHealth(unparsedApp)).not.toThrow();
        expect(telemetryOutcomes(unparsedApp)['Network.webSocketCreated']).toBe('not-observed');
    });

    it('marks visible controls without the App callback as a logpoint coverage gap', () => {
        const contradiction = completeTelemetry();
        contradiction.counts = {
            'collector-ready': 1,
            'Network.requestWillBeSent': 2,
            'Page.frameNavigated': 1,
            'App-logpoint-installed': 1,
            'document-init': 1,
            'public-dom-transition': 1,
            'public-transport-visible': 1,
        };
        expect(telemetryOutcomes(contradiction)['App-fulfilled']).toBe('unknown');
        expect(() => assertTelemetryHealth(contradiction)).toThrow('logpoint coverage is incomplete');
    });

    it('requires the callback on a successful child while preserving failed-load absence', () => {
        const failedLoad = completeTelemetry();
        failedLoad.counts = {
            'collector-ready': 1,
            'Network.requestWillBeSent': 2,
            'Page.frameNavigated': 1,
            'App-logpoint-installed': 1,
            'document-init': 1,
            'public-dom-transition': 1,
        };
        expect(() => assertTelemetryHealth(failedLoad)).not.toThrow();
        expect(() => assertSuccessfulAppCoverage(failedLoad, 1)).not.toThrow();
        expect(() => assertSuccessfulAppCoverage(failedLoad, 0)).toThrow('Successful child lacks');
        const unparsedApp = completeTelemetry();
        unparsedApp.counts = {
            'collector-ready': 1,
            'Network.requestWillBeSent': 2,
            'Page.frameNavigated': 1,
            'document-init': 1,
            'public-dom-transition': 1,
        };
        expect(telemetryOutcomes(unparsedApp)['App-fulfilled']).toBe('unknown');
        expect(() => assertSuccessfulAppCoverage(unparsedApp, 1)).not.toThrow();
        expect(() => assertSuccessfulAppCoverage(unparsedApp, 0)).toThrow('Successful child lacks');
    });
});
