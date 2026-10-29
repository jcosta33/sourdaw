import { recordOf } from './journal.ts';

export function assertTelemetryHealth(value: unknown): void {
    const health = recordOf(value, 'collector health');
    const counts = recordOf(health.counts, 'event counts');
    for (const name of [
        'collector-ready',
        'Network.requestWillBeSent',
        'Page.frameNavigated',
        'document-init',
        'public-dom-transition',
    ]) {
        if (typeof counts[name] !== 'number' || !Number.isFinite(counts[name]) || counts[name] <= 0) {
            throw new Error(`Required actual telemetry was not observed: ${name}`);
        }
    }
    const websocket = recordOf(health.websocket, 'websocket health');
    for (const errors of [health.errors, websocket.errors, websocket.missingCreation]) {
        if (!Array.isArray(errors) || errors.length !== 0) {
            throw new Error('Collector errors or incomplete websocket coverage remain');
        }
    }
    if (typeof websocket.created !== 'number' || !Number.isSafeInteger(websocket.created) || websocket.created < 0) {
        throw new Error('Invalid websocket creation count');
    }
}

export function telemetryOutcomes(value: unknown): Record<string, 'observed' | 'not-observed' | 'unknown'> {
    const health = recordOf(value, 'collector health');
    const counts = recordOf(health.counts, 'event counts');
    const websocket = recordOf(health.websocket, 'websocket health');
    const logpointCount = counts['App-logpoint-installed'];
    if (
        logpointCount !== undefined &&
        (typeof logpointCount !== 'number' || !Number.isFinite(logpointCount) || logpointCount < 0)
    ) {
        throw new TypeError('Invalid App logpoint coverage count');
    }
    return {
        ...Object.fromEntries(
            ['App-fulfilled', 'public-transport-visible'].map((name) => {
                const count = counts[name];
                if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count) || count < 0)) {
                    throw new TypeError(`Invalid outcome count: ${name}`);
                }
                if (typeof count === 'number' && count > 0) {
                    return [name, 'observed'];
                }
                if (name === 'App-fulfilled' && !(typeof logpointCount === 'number' && logpointCount > 0)) {
                    return [name, 'unknown'];
                }
                return [name, 'not-observed'];
            })
        ),
        'Network.webSocketCreated': websocket.created === 0 ? 'not-observed' : 'observed',
    };
}
