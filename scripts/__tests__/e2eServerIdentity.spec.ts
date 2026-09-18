// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_E2E_PORT,
    SOURDAW_E2E_PORT_ENV,
    SOURDAW_E2E_ROOT_HEADER,
    assertServingCheckoutIdentity,
    createSourdawRootHeaderMiddleware,
    e2eOrigin,
    isSourdawE2eServeMode,
    originAnswers,
    readServingCheckoutRoot,
    resolveE2ePort,
} from '../e2eServerIdentity.ts';

import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * Lane-scoped browser verification (scripts/e2eServerIdentity.ts). Proves
 * the port derivation feeding playwright's baseURL/webServer, the marker's
 * e2e-mode-only contract, and the identity assertion that aborts before a
 * foreign checkout's dev server gets reused. Servers here are plain
 * node:http listeners driving the same middleware the vite plugin installs,
 * so the mechanism is exercised over a real HTTP round trip.
 */

const runningServers: Server[] = [];
const tempRoots: string[] = [];

function makeTempRoot(name: string): string {
    const root = mkdtempSync(join(tmpdir(), `sourdaw-e2e-identity-${name}-`));
    tempRoots.push(root);
    return root;
}

async function startServingServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<string> {
    const server = createServer(handler);
    runningServers.push(server);
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('expected the identity probe server to listen on a TCP port');
    }
    return `http://127.0.0.1:${address.port}`;
}

/** The handler shape a dev server gets: the marker middleware, then the response. */
function markerHandler(root: string): (request: IncomingMessage, response: ServerResponse) => void {
    const middleware = createSourdawRootHeaderMiddleware(root);
    return (request, response) => {
        middleware(request, response, () => {
            response.end('ok');
        });
    };
}

afterEach(async () => {
    await Promise.all(
        runningServers.map((server) => {
            return new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        })
    );
    runningServers.length = 0;
    for (const root of tempRoots) {
        rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('resolveE2ePort', () => {
    it('keeps the human default 5173 when the env var is unset or empty', () => {
        expect(resolveE2ePort(undefined)).toBe(DEFAULT_E2E_PORT);
        expect(resolveE2ePort('')).toBe(DEFAULT_E2E_PORT);
    });

    it('accepts a lane-unique integer port', () => {
        expect(resolveE2ePort('6123')).toBe(6123);
    });

    it('refuses non-integer or out-of-range values, naming the env var and the value', () => {
        for (const invalid of ['vite', '5173.5', '0x1f', ' 6123', '-1', '1023', '65536']) {
            expect(() => resolveE2ePort(invalid)).toThrow(SOURDAW_E2E_PORT_ENV);
            expect(() => resolveE2ePort(invalid)).toThrow(invalid);
        }
    });
});

describe('e2eOrigin', () => {
    it('builds the localhost origin for a port', () => {
        expect(e2eOrigin(5173)).toBe('http://localhost:5173');
        expect(e2eOrigin(6123)).toBe('http://localhost:6123');
    });
});

describe('isSourdawE2eServeMode', () => {
    it('marks only e2e mode as serving the identity marker', () => {
        expect(isSourdawE2eServeMode('e2e')).toBe(true);
        for (const mode of ['development', 'test', 'production', '']) {
            expect(isSourdawE2eServeMode(mode)).toBe(false);
        }
    });
});

describe('playwright config port derivation', () => {
    type PlaywrightConfigModule = typeof import('../../playwright.config');

    // The port is resolved at module evaluation, so each case re-imports the
    // config under a freshly stubbed env.
    async function loadPlaywrightConfig(): Promise<PlaywrightTestConfig> {
        vi.resetModules();
        const loaded: PlaywrightConfigModule = await import('../../playwright.config');
        return loaded.default;
    }

    /** The single webServer object this config defines (Playwright also allows arrays). */
    type SingleWebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;

    function requiredSingleWebServer(config: PlaywrightTestConfig): SingleWebServer {
        const webServer = config.webServer;
        if (webServer === undefined) {
            throw new Error('playwright config must define a webServer');
        }
        if (Array.isArray(webServer)) {
            const first = webServer[0];
            if (first === undefined) {
                throw new Error('playwright config webServer array must not be empty');
            }
            return first;
        }
        return webServer;
    }

    function requiredBaseURL(config: PlaywrightTestConfig): string {
        if (config.use?.baseURL === undefined) {
            throw new Error('playwright config must define a use.baseURL');
        }
        return config.use.baseURL;
    }

    it('defaults baseURL and webServer.url to port 5173 without the env var', async () => {
        vi.stubEnv(SOURDAW_E2E_PORT_ENV, undefined);
        const config = await loadPlaywrightConfig();
        const webServer = requiredSingleWebServer(config);
        expect(requiredBaseURL(config)).toBe('http://localhost:5173');
        expect(webServer.url).toBe('http://localhost:5173');
    });

    it('derives baseURL and webServer.url from the env var and binds the dev server with --strictPort', async () => {
        vi.stubEnv(SOURDAW_E2E_PORT_ENV, '6123');
        const config = await loadPlaywrightConfig();
        const webServer = requiredSingleWebServer(config);
        expect(requiredBaseURL(config)).toBe('http://localhost:6123');
        expect(webServer.url).toBe('http://localhost:6123');
        expect(webServer.command).toBe('pnpm dev --mode e2e --port 6123 --strictPort');
    });

    it('refuses to load the config when the env value is not a usable port', async () => {
        vi.stubEnv(SOURDAW_E2E_PORT_ENV, '70000');
        await expect(loadPlaywrightConfig()).rejects.toThrow(SOURDAW_E2E_PORT_ENV);
    });
});

describe('serving-checkout identity', () => {
    it('stamps a percent-encoded, header-safe serving root on every response', async () => {
        const root = makeTempRoot('stamped');
        const origin = await startServingServer(markerHandler(root));
        const response = await fetch(origin);
        const stamped = response.headers.get(SOURDAW_E2E_ROOT_HEADER);
        await response.body?.cancel();
        if (stamped === null) {
            throw new Error('expected the middleware to stamp the marker header');
        }
        expect(stamped).toBe(encodeURIComponent(root));
        expect(stamped).toMatch(/^[\x20-\x7E]*$/);
        await expect(readServingCheckoutRoot(origin)).resolves.toBe(root);
    });

    it('round-trips a non-latin1 checkout root and still refuses a foreign root', async () => {
        // NFD spelling as macOS writes an accented home directory: the
        // combining acute (U+0301) sits above latin1, so a raw header value
        // would make the response throw ERR_INVALID_CHAR.
        const accentedRoot = `${makeTempRoot('accented')}/cafe\u0301`;
        mkdirSync(accentedRoot);
        const origin = await startServingServer(markerHandler(accentedRoot));

        const response = await fetch(origin);
        const stamped = response.headers.get(SOURDAW_E2E_ROOT_HEADER);
        await response.body?.cancel();
        if (stamped === null) {
            throw new Error('expected the middleware to stamp the marker header');
        }
        expect(stamped).toMatch(/^[\x20-\x7E]*$/);
        await expect(readServingCheckoutRoot(origin)).resolves.toBe(accentedRoot);
        await expect(assertServingCheckoutIdentity(origin, accentedRoot)).resolves.toBeUndefined();

        const expectedRoot = makeTempRoot('this-lane');
        const failure = await assertServingCheckoutIdentity(origin, expectedRoot).then(
            () => null,
            (error: unknown) => error
        );
        if (failure === null) {
            throw new Error('expected the identity assertion to reject on a foreign marker');
        }
        if (!(failure instanceof Error)) {
            throw new Error('expected the identity assertion to reject with an Error');
        }
        expect(failure.message).toContain(accentedRoot);
        expect(failure.message).toContain(expectedRoot);
        expect(failure.message).toContain(origin);
    });

    it('accepts a server whose marker matches this checkout', async () => {
        const root = makeTempRoot('own');
        const origin = await startServingServer(markerHandler(root));
        await expect(assertServingCheckoutIdentity(origin, root)).resolves.toBeUndefined();
    });

    it('treats a symlinked spelling of the expected root as the same checkout', async () => {
        const servingRoot = makeTempRoot('serving');
        const linkedRoot = `${servingRoot}-link`;
        symlinkSync(servingRoot, linkedRoot);
        tempRoots.push(linkedRoot);
        const origin = await startServingServer(markerHandler(servingRoot));
        await expect(assertServingCheckoutIdentity(origin, linkedRoot)).resolves.toBeUndefined();
    });

    it('aborts with both roots and the origin when the marker names a different checkout', async () => {
        const servingRoot = makeTempRoot('foreign');
        const expectedRoot = makeTempRoot('this-lane');
        const origin = await startServingServer(markerHandler(servingRoot));

        const failure = await assertServingCheckoutIdentity(origin, expectedRoot).then(
            () => null,
            (error: unknown) => error
        );
        if (failure === null) {
            throw new Error('expected the identity assertion to reject on a foreign marker');
        }
        if (!(failure instanceof Error)) {
            throw new Error('expected the identity assertion to reject with an Error');
        }
        expect(failure.message).toContain(servingRoot);
        expect(failure.message).toContain(expectedRoot);
        expect(failure.message).toContain(origin);
    });

    it('passes through a server carrying no marker, such as a plain dev server outside e2e mode', async () => {
        const origin = await startServingServer((_request, response) => {
            response.end('ok');
        });
        await expect(assertServingCheckoutIdentity(origin, makeTempRoot('expected'))).resolves.toBeUndefined();
    });

    it('serves two distinct checkouts on two distinct ports without cross-talk', async () => {
        const rootA = makeTempRoot('lane-a');
        const rootB = makeTempRoot('lane-b');
        const originA = await startServingServer(markerHandler(rootA));
        const originB = await startServingServer(markerHandler(rootB));
        expect(originA).not.toBe(originB);
        await expect(readServingCheckoutRoot(originA)).resolves.toBe(rootA);
        await expect(readServingCheckoutRoot(originB)).resolves.toBe(rootB);
    });

    it('detects whether an origin answers at all', async () => {
        const root = makeTempRoot('answers');
        const origin = await startServingServer(markerHandler(root));
        await expect(originAnswers(origin)).resolves.toBe(true);
        await expect(originAnswers('http://127.0.0.1:1')).resolves.toBe(false);
    });
});
