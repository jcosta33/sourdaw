import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { isSourdawE2eServeMode } from './e2eServerIdentity.ts';

import type { Plugin } from 'vite';

export const STARTUP_DIAGNOSTIC_TARGET = '/src/app/initDeviceStateReconciliation.ts';
export const STARTUP_DIAGNOSTIC_CLIENT = '/__sourdaw_e2e_startup/client.js';
export const STARTUP_DIAGNOSTIC_HEARTBEAT = '/__sourdaw_e2e_startup/heartbeat';
const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_EVENTS = 4_096;
const MAX_DOCUMENTS = 128;
const MAX_CLIENT_BEATS = 13;
const MAX_HEARTBEAT_BYTES = 512;

// This independent script deliberately imports no application modules. Its HTTP
// receipts survive a stalled Playwright event stream when the renderer still runs.
const CLIENT_SCRIPT = `(() => {
    let sequence = 0;
    let timer;
    const send = () => {
        sequence += 1;
        void fetch('${STARTUP_DIAGNOSTIC_HEARTBEAT}', {
            method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', keepalive: true,
            body: JSON.stringify({
                timeOrigin: performance.timeOrigin, sequence, readyState: document.readyState,
                entryStarted: document.documentElement.hasAttribute('data-sourdaw-entry-started'),
                bootstrapStarted: document.documentElement.hasAttribute('data-sourdaw-bootstrap-started'),
                appRenderIssued: document.documentElement.hasAttribute('data-sourdaw-app-render-issued'),
                retryIssued: document.documentElement.hasAttribute('data-sourdaw-app-import-retry-issued')
            })
        }).catch(() => undefined);
        if (sequence >= ${MAX_CLIENT_BEATS}) { clearInterval(timer); }
    };
    timer = setInterval(send, ${HEARTBEAT_INTERVAL_MS});
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    send();
})();`;

type Heartbeat = {
    timeOrigin: number;
    sequence: number;
    readyState: 'loading' | 'interactive' | 'complete';
    entryStarted: boolean;
    bootstrapStarted: boolean;
    appRenderIssued: boolean;
    retryIssued: boolean;
};

function readHeartbeat(text: string): Heartbeat | undefined {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    if (
        !('timeOrigin' in value) ||
        typeof value.timeOrigin !== 'number' ||
        !Number.isFinite(value.timeOrigin) ||
        value.timeOrigin < 1e12 ||
        value.timeOrigin > 4e12 ||
        !('sequence' in value) ||
        typeof value.sequence !== 'number' ||
        !Number.isInteger(value.sequence) ||
        value.sequence < 1 ||
        value.sequence > MAX_CLIENT_BEATS ||
        !('readyState' in value) ||
        (value.readyState !== 'loading' && value.readyState !== 'interactive' && value.readyState !== 'complete') ||
        !('entryStarted' in value) ||
        typeof value.entryStarted !== 'boolean' ||
        !('bootstrapStarted' in value) ||
        typeof value.bootstrapStarted !== 'boolean' ||
        !('appRenderIssued' in value) ||
        typeof value.appRenderIssued !== 'boolean' ||
        !('retryIssued' in value) ||
        typeof value.retryIssued !== 'boolean'
    ) {
        return undefined;
    }
    return {
        timeOrigin: value.timeOrigin,
        sequence: value.sequence,
        readyState: value.readyState,
        entryStarted: value.entryStarted,
        bootstrapStarted: value.bootstrapStarted,
        appRenderIssued: value.appRenderIssued,
        retryIssued: value.retryIssued,
    };
}

function errorKind(error: unknown): string {
    if (error instanceof TypeError) {
        return 'TypeError';
    }
    if (error instanceof SyntaxError) {
        return 'SyntaxError';
    }
    if (error instanceof Error) {
        return 'Error';
    }
    return 'other';
}

/** Only the existing checkout-identified E2E dev-server route admits diagnostics. */
export function sourdawE2eStartupDiagnosticsPlugin(): Plugin {
    let dispose: (() => void) | undefined;
    let activeRoot: string | undefined;
    return {
        name: 'sourdaw-e2e-startup-diagnostics',
        apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),
        configureServer(server) {
            if (!server.httpServer) {
                return;
            }
            activeRoot = server.config.root;
            const environment = server.environments.client;
            const original = environment.transformRequest;
            const requestContext = new AsyncLocalStorage<number>();
            const documents = new Map<number, number>();
            const responses = new Set<() => void>();
            let requestId = 0;
            let transformId = 0;
            let eventCount = 0;
            let closed = false;
            let activeUntil = 0;
            let previousTick = performance.now();
            const record = (event: string, fields: Record<string, number | string | boolean | null> = {}): void => {
                if (closed || eventCount >= MAX_EVENTS) {
                    return;
                }
                eventCount += 1;
                try {
                    server.config.logger.info(
                        JSON.stringify({
                            source: 'e2e-startup',
                            event,
                            eventId: eventCount,
                            pid: process.pid,
                            wallTime: Date.now(),
                            monotonicTime: performance.now(),
                            ...fields,
                        }),
                        { timestamp: false }
                    );
                } catch {
                    // A diagnostic sink must never change the observed request's outcome.
                }
            };
            const transformRequest: typeof original = function (this: typeof environment, ...args) {
                if (args[0].split(/[?#]/, 1)[0] !== STARTUP_DIAGNOSTIC_TARGET) {
                    return original.apply(this, args);
                }
                const id = ++transformId;
                const correlation = requestContext.getStore() ?? null;
                record('transform-start', { requestId: correlation, transformId: id, path: STARTUP_DIAGNOSTIC_TARGET });
                try {
                    const result = original.apply(this, args);
                    void result.then(
                        (value) =>
                            record('transform-resolve', {
                                requestId: correlation,
                                transformId: id,
                                found: value !== null,
                            }),
                        (error: unknown) =>
                            record('transform-reject', {
                                requestId: correlation,
                                transformId: id,
                                kind: errorKind(error),
                            })
                    );
                    return result;
                } catch (error) {
                    record('transform-reject', { requestId: correlation, transformId: id, kind: errorKind(error) });
                    throw error;
                }
            };
            // Vite 8's HTTP transform middleware calls this environment method.
            // Observing the legacy server.transformRequest would miss that route.
            environment.transformRequest = transformRequest;
            const timer = setInterval(() => {
                const now = performance.now();
                if (now <= activeUntil) {
                    record('server-heartbeat', { intervalMs: now - previousTick });
                }
                previousTick = now;
            }, HEARTBEAT_INTERVAL_MS);
            timer.unref();
            server.middlewares.use((request, response, next) => {
                const path = (request.url ?? '').split(/[?#]/, 1)[0];
                if (path === STARTUP_DIAGNOSTIC_CLIENT && request.method === 'GET') {
                    response.setHeader('Content-Type', 'text/javascript');
                    response.setHeader('Cache-Control', 'no-store');
                    response.end(CLIENT_SCRIPT);
                    return;
                }
                if (path === STARTUP_DIAGNOSTIC_HEARTBEAT && request.method === 'POST') {
                    let body = '';
                    let bytes = 0;
                    const data = (chunk: Buffer): void => {
                        bytes += chunk.length;
                        if (bytes <= MAX_HEARTBEAT_BYTES) {
                            body += chunk.toString('utf8');
                        }
                    };
                    const end = (): void => {
                        const beat = bytes <= MAX_HEARTBEAT_BYTES ? readHeartbeat(body) : undefined;
                        if (beat && (documents.has(beat.timeOrigin) || documents.size < MAX_DOCUMENTS)) {
                            const previous = documents.get(beat.timeOrigin) ?? 0;
                            if (beat.sequence > previous) {
                                documents.set(beat.timeOrigin, beat.sequence);
                                activeUntil = performance.now() + MAX_CLIENT_BEATS * HEARTBEAT_INTERVAL_MS;
                                record('renderer-heartbeat', { ...beat, observationUntilMs: activeUntil });
                            }
                        }
                        response.statusCode = 204;
                        response.end();
                        cleanup();
                    };
                    const cleanup = (): void => {
                        body = '';
                        request.off('data', data);
                        request.off('end', end);
                        response.off('close', cleanup);
                        responses.delete(cleanup);
                    };
                    responses.add(cleanup);
                    request.on('data', data);
                    request.once('end', end);
                    response.once('close', cleanup);
                    return;
                }
                if (path !== STARTUP_DIAGNOSTIC_TARGET || request.method !== 'GET') {
                    next();
                    return;
                }
                const id = ++requestId;
                activeUntil = performance.now() + MAX_CLIENT_BEATS * HEARTBEAT_INTERVAL_MS;
                record('http-received', {
                    requestId: id,
                    path: STARTUP_DIAGNOSTIC_TARGET,
                    observationUntilMs: activeUntil,
                });
                const finish = (): void => record('http-finish', { requestId: id, status: response.statusCode });
                const close = (): void => {
                    record('http-close', { requestId: id, finished: response.writableFinished });
                    cleanup();
                };
                const cleanup = (): void => {
                    response.off('finish', finish);
                    response.off('close', close);
                    responses.delete(cleanup);
                };
                responses.add(cleanup);
                response.once('finish', finish);
                response.once('close', close);
                requestContext.run(id, next);
            });
            dispose = () => {
                if (closed) {
                    return;
                }
                record('observer-closed');
                closed = true;
                activeRoot = undefined;
                clearInterval(timer);
                for (const cleanup of responses) {
                    cleanup();
                }
                documents.clear();
                requestContext.disable();
                if (environment.transformRequest === transformRequest) {
                    environment.transformRequest = original;
                }
            };
            server.httpServer.once('close', dispose);
        },
        transformIndexHtml(_html, context) {
            if (!activeRoot || context.filename !== resolve(activeRoot, 'index.html')) {
                return;
            }
            return [
                { tag: 'script', attrs: { defer: true, src: STARTUP_DIAGNOSTIC_CLIENT }, injectTo: 'head-prepend' },
            ];
        },
        closeBundle() {
            dispose?.();
        },
    };
}
