import { recordOf } from './journal.ts';

export function assertTelemetryHealth(value: unknown): void {
    const health = recordOf(value, 'collector health');
    const counts = recordOf(health.counts, 'event counts');
    const required =
        health.profile === 'transport'
            ? ['collector-ready', 'Network.requestWillBeSent', 'Page.frameNavigated']
            : [
                  'collector-ready',
                  'Network.requestWillBeSent',
                  'Page.frameNavigated',
                  'document-init',
                  'public-dom-transition',
              ];
    for (const name of required) {
        if (typeof counts[name] !== 'number' || !Number.isFinite(counts[name]) || counts[name] <= 0) {
            throw new Error(`Required actual telemetry was not observed: ${name}`);
        }
    }
    const websocket = recordOf(health.websocket, 'websocket health');
    const coverageErrors =
        health.profile === 'transport'
            ? [health.errors, websocket.errors]
            : [health.errors, websocket.errors, websocket.missingCreation];
    for (const errors of coverageErrors) {
        if (!Array.isArray(errors) || errors.length > 0) {
            throw new Error('Collector errors or incomplete websocket coverage remain');
        }
    }
    if (typeof websocket.created !== 'number' || !Number.isSafeInteger(websocket.created) || websocket.created < 0) {
        throw new Error('Invalid websocket creation count');
    }
    const outcomes = telemetryOutcomes(value);
    if (outcomes['public-transport-visible'] === 'observed' && outcomes['App-fulfilled'] !== 'observed') {
        throw new Error('Playback controls visible without App fulfillment callback: logpoint coverage is incomplete');
    }
}

export function telemetryOutcomes(value: unknown): Record<string, 'observed' | 'not-observed' | 'unknown'> {
    const health = recordOf(value, 'collector health');
    const counts = recordOf(health.counts, 'event counts');
    const websocket = recordOf(health.websocket, 'websocket health');
    const logpointCount = counts['App-logpoint-installed'];
    if (
        logpointCount !== undefined &&
        (typeof logpointCount !== 'number' || !Number.isSafeInteger(logpointCount) || logpointCount < 0)
    ) {
        throw new TypeError('Invalid App logpoint coverage count');
    }
    const observedCount = (name: string): number => {
        const count = counts[name];
        if (count === undefined) {
            return 0;
        }
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
            throw new TypeError(`Invalid outcome count: ${name}`);
        }
        return count;
    };
    const callback = observedCount('App-fulfilled');
    const controls = observedCount('public-transport-visible');
    if (health.profile === 'transport') {
        return {
            'App-fulfilled': callback > 0 ? 'observed' : 'unknown',
            'public-transport-visible': controls > 0 ? 'observed' : 'unknown',
            'Network.webSocketCreated': websocket.created === 0 ? 'unknown' : 'observed',
        };
    }
    let callbackOutcome: 'observed' | 'not-observed' | 'unknown' = 'unknown';
    if (callback > 0) {
        callbackOutcome = 'observed';
    } else if ((logpointCount ?? 0) > 0 && controls === 0) {
        callbackOutcome = 'not-observed';
    }
    return {
        'App-fulfilled': callbackOutcome,
        'public-transport-visible': controls > 0 ? 'observed' : 'not-observed',
        'Network.webSocketCreated': websocket.created === 0 ? 'not-observed' : 'observed',
    };
}

export function assertSuccessfulAppCoverage(value: unknown, childCode: number): void {
    if (childCode === 0 && telemetryOutcomes(value)['App-fulfilled'] !== 'observed') {
        throw new Error('Successful child lacks an observed App fulfillment callback');
    }
}
