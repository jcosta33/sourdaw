import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import { createServer, type ServerOptions, type WebSocketClient } from 'vite';

function deferred<T>() {
    let complete!: (value: T) => void;
    const promise = new Promise<T>((_resolve) => (complete = _resolve));
    return { promise, complete };
}

async function observed<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Unobserved fixture event: ${label}`)), 10_000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

for (const hmr of [false, true]) {
    test(`${hmr ? 'developer' : 'immutable E2E'} document handles an HMR disconnect during App import`, async ({
        page,
    }, testInfo) => {
        const root = resolve(import.meta.dirname, 'fixtures/hmrDisconnect');
        const cacheDir = await mkdtemp(join(tmpdir(), 'sourdaw-hmr-disconnect-'));
        const identity = { root, pid: process.pid, token: randomUUID() };
        const pendingApp = deferred<void>();
        const releaseApp = deferred<void>();
        const connected = deferred<WebSocketClient>();
        const browserConnected = deferred<void>();
        const disconnected = deferred<void>();
        const disconnectHandled = deferred<void>();
        const reloaded = deferred<void>();
        const reconnectPollingEvents: string[] = [];
        const navigationRequests: unknown[] = [];
        const documents: string[] = [];
        const errors: string[] = [];
        const events: { event: string; at: number; detail: unknown }[] = [];
        const record = (event: string, detail: unknown): void => {
            events.push({ event, at: performance.now(), detail });
        };
        const serverOptions: ServerOptions = { host: '127.0.0.1', port: 0, strictPort: true };
        if (!hmr) {
            serverOptions.hmr = false;
        }
        const server = await createServer({
            configFile: false,
            root,
            cacheDir,
            server: serverOptions,
            plugins: [
                {
                    name: 'pending-app-module',
                    configureServer(vite) {
                        vite.middlewares.use((request, response, next) => {
                            const path = request.url?.split('?')[0];
                            if (path === '/health') {
                                response.setHeader('Content-Type', 'application/json');
                                response.end(JSON.stringify(identity));
                                return;
                            }
                            if (path !== '/App.js') {
                                next();
                                return;
                            }
                            record('pending-App-request', request.url);
                            pendingApp.complete();
                            response.once('close', () => record('App-response-close', response.writableFinished));
                            void releaseApp.promise.then(() => {
                                if (!response.destroyed) {
                                    next();
                                }
                            });
                        });
                    },
                },
            ],
        });
        server.ws.on('vite:client:connect', (_data, client) => connected.complete(client));
        const session = await page.context().newCDPSession(page);
        session.on('Page.frameRequestedNavigation', (event) => {
            record('requested-navigation', event);
            navigationRequests.push(event);
            if (event.reason === 'reload') {
                reloaded.complete();
            }
        });
        session.on('Network.requestWillBeSent', (event) => {
            if (event.type === 'Document') {
                documents.push(event.request.url);
            }
        });
        session.on('Network.webSocketClosed', (event) => {
            record('socket-closed', event);
            disconnected.complete();
        });
        page.on('console', (message) => {
            record('console', { type: message.type(), text: message.text() });
            if (message.text() === '[vite] connected.') {
                browserConnected.complete();
            }
            if (message.text() === 'fixture-disconnected') {
                disconnectHandled.complete();
            }
            if (message.text() === '[vite] server connection lost. Polling for restart...') {
                reconnectPollingEvents.push(message.text());
                record('reconnect-polling-started', message.text());
            }
            if (message.type() === 'error') {
                errors.push(message.text());
            }
        });
        page.on('pageerror', (error) => errors.push(error.message));
        try {
            await session.send('Network.enable');
            await session.send('Page.enable');
            await server.listen();
            const address = server.httpServer?.address();
            if (!address || typeof address === 'string') {
                throw new Error('Missing owned HTTP listener');
            }
            const origin = `http://127.0.0.1:${address.port}`;
            const health = async (): Promise<void> => {
                const response = await fetch(`${origin}/health`);
                expect(response.status).toBe(200);
                expect(await response.json()).toEqual(identity);
            };
            await health();
            await page.goto(origin, { waitUntil: 'domcontentloaded' });
            await observed(pendingApp.promise, 'pending App HTTP request');
            await expect(page.locator('html')).toHaveAttribute('data-boot', '1');
            await expect(page.locator('#content')).toHaveText('App import pending');
            const timeOrigin = await page.evaluate(() => performance.timeOrigin);
            const client = await observed(connected.promise, 'owned server socket connected');
            await observed(browserConnected.promise, 'browser Vite connected frame');
            expect(server.ws.clients.has(client)).toBe(true);
            expect(client.socket.readyState).toBe(1);
            expect(client.socket.protocol).toBe('vite-hmr');
            server.ws.send({ type: 'custom', event: 'fixture:message', data: { message: 'retained' } });
            await expect(page.locator('html')).toHaveAttribute('data-custom-message', 'retained');
            record('terminate-own-connected-socket', { timeOrigin });
            client.socket.terminate();
            await observed(disconnected.promise, 'CDP socket closed');
            await observed(disconnectHandled.promise, 'Vite custom disconnect delivered');
            if (hmr) {
                await observed(reloaded.promise, 'developer reload requested');
                await expect(page.locator('html')).toHaveAttribute('data-boot', '2');
            }
            await health();
            releaseApp.complete();
            await expect(page.locator('#content')).toHaveText('Healthy App module completed');
            await expect(page.locator('#content')).toHaveCSS('color', 'rgb(12, 34, 56)');
            const finalTimeOrigin = await page.evaluate(() => performance.timeOrigin);
            record('App-and-CSS-fulfilled', { timeOrigin, finalTimeOrigin, documents });
            await health();
            expect(errors).toEqual([]);
            if (hmr) {
                expect(reconnectPollingEvents).toHaveLength(1);
                expect(finalTimeOrigin).not.toBe(timeOrigin);
                expect(documents).toHaveLength(2);
                expect(navigationRequests).toEqual([expect.objectContaining({ reason: 'reload' })]);
            } else {
                expect(
                    reconnectPollingEvents,
                    'An immutable document must not enter Vite reconnect polling'
                ).toHaveLength(0);
                expect(
                    navigationRequests,
                    'A disconnected editor socket must not navigate an immutable document'
                ).toEqual([]);
                expect(finalTimeOrigin).toBe(timeOrigin);
                expect(documents).toHaveLength(1);
                await expect(page.locator('html')).toHaveAttribute('data-boot', '1');
            }
        } finally {
            releaseApp.complete();
            try {
                await page.close();
            } finally {
                try {
                    await server.close();
                } finally {
                    await rm(cacheDir, { recursive: true, force: true });
                    await testInfo.attach('hmr-disconnect-events', {
                        body: JSON.stringify(
                            { hmr, identity, events, reconnectPollingEvents, navigationRequests, documents, errors },
                            null,
                            2
                        ),
                        contentType: 'application/json',
                    });
                }
            }
        }
    });
}
