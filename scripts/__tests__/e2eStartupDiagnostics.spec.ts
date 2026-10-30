// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, type Browser } from '@playwright/test';
import { createLogger, createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import {
    sourdawE2eStartupDiagnosticsPlugin,
    STARTUP_DIAGNOSTIC_CLIENT,
    STARTUP_DIAGNOSTIC_HEARTBEAT,
    STARTUP_DIAGNOSTIC_TARGET,
} from '../e2eStartupDiagnostics.ts';

type Fixture = {
    root: string;
    server: ViteDevServer;
    origin: string;
    events: Array<Record<string, unknown>>;
    original: ViteDevServer['environments']['client']['transformRequest'];
};

const fixtures: Fixture[] = [];
const browsers: Browser[] = [];

function deferred<Value>(): {
    promise: Promise<Value>;
    resolve: (value: Value) => void;
    reject: (error: Error) => void;
} {
    let resolveValue: (value: Value) => void = () => undefined;
    let rejectValue: (error: Error) => void = () => undefined;
    const promise = new Promise<Value>((resolve, reject) => {
        resolveValue = resolve;
        rejectValue = reject;
    });
    return { promise, resolve: resolveValue, reject: rejectValue };
}

async function fixture(mode = 'e2e', gate?: ReturnType<typeof deferred<string>>): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), 'sourdaw-startup-diagnostic-'));
    const target = join(root, STARTUP_DIAGNOSTIC_TARGET);
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(target, 'export const fixtureValue = 23;');
    await writeFile(
        join(root, 'index.html'),
        '<!doctype html><html><head></head><body>Startup fixture<script type="module" src="/entry.ts"></script></body></html>'
    );
    await writeFile(join(root, 'other.html'), '<!doctype html><html><head></head><body>Other fixture</body></html>');
    await writeFile(
        join(root, 'entry.ts'),
        `import '${STARTUP_DIAGNOSTIC_TARGET}'; document.documentElement.dataset.fixtureReady = 'yes';`
    );
    const events: Array<Record<string, unknown>> = [];
    const logger = createLogger('silent');
    logger.info = (message) => {
        if (!message.startsWith('{"source":"e2e-startup"')) {
            return;
        }
        const value: unknown = JSON.parse(message);
        if (typeof value === 'object' && value !== null) {
            events.push({ ...value });
        }
    };
    let original: Fixture['original'] | undefined;
    const control: Plugin = {
        name: 'held-startup-fixture',
        configureServer(server) {
            original = server.environments.client.transformRequest;
        },
        load(id) {
            if (id.split('?')[0] === target && gate) {
                return gate.promise;
            }
        },
    };
    const server = await createServer({
        configFile: false,
        root,
        mode,
        customLogger: logger,
        server: {
            host: '127.0.0.1',
            port: 0,
            hmr: false,
            headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'" },
        },
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [control, sourdawE2eStartupDiagnosticsPlugin()],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string' || !original) {
        throw new Error('Vite fixture did not start');
    }
    const result = { root, server, origin: `http://127.0.0.1:${address.port}`, events, original };
    fixtures.push(result);
    return result;
}

afterEach(async () => {
    for (const browser of browsers.splice(0)) {
        await browser.close();
    }
    for (const item of fixtures.splice(0)) {
        await item.server.close();
        await rm(item.root, { recursive: true, force: true });
    }
});

function event(item: Fixture, name: string): Record<string, unknown> | undefined {
    return item.events.find((value) => value.event === name);
}

describe('startup server diagnostics', () => {
    it('observes the actual held HTTP transform and preserves its response, correlation and cleanup', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const pending = fetch(`${item.origin}${STARTUP_DIAGNOSTIC_TARGET}?private=hidden-value`);
        try {
            await expect.poll(() => event(item, 'transform-start')).toBeDefined();
            const received = event(item, 'http-received');
            const started = event(item, 'transform-start');
            expect(received?.requestId).toEqual(started?.requestId);
            expect(started?.path).toBe(STARTUP_DIAGNOSTIC_TARGET);
            expect(event(item, 'transform-resolve')).toBeUndefined();
            await expect.poll(() => event(item, 'server-heartbeat'), { timeout: 8_000 }).toBeDefined();
        } finally {
            gate.resolve('export const fixtureValue = 23;');
        }
        const response = await pending;
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('fixtureValue = 23');
        await expect.poll(() => event(item, 'http-close')).toMatchObject({ finished: true });
        expect(event(item, 'http-finish')).toMatchObject({
            requestId: event(item, 'http-received')?.requestId,
            status: 200,
        });
        expect(event(item, 'transform-resolve')).toMatchObject({
            transformId: event(item, 'transform-start')?.transformId,
            found: true,
        });
        expect(JSON.stringify(item.events)).not.toContain('hidden-value');
        await item.server.close();
        expect(item.server.environments.client.transformRequest).toBe(item.original);
        expect(event(item, 'observer-closed')).toBeDefined();
    }, 15_000);

    it('observes a real load rejection without changing the HTTP failure or exposing its message', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const pending = fetch(`${item.origin}${STARTUP_DIAGNOSTIC_TARGET}`);
        await expect.poll(() => event(item, 'transform-start')).toBeDefined();
        gate.reject(new TypeError('private-token-never-log'));
        const response = await pending;
        expect(response.status).toBe(500);
        await response.text();
        expect(event(item, 'transform-reject')).toMatchObject({ kind: 'TypeError' });
        expect(JSON.stringify(item.events)).not.toContain('private-token-never-log');
    });

    it('records a premature HTTP close independently of the held transform result', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const abort = new AbortController();
        const pending = fetch(`${item.origin}${STARTUP_DIAGNOSTIC_TARGET}`, { signal: abort.signal });
        await expect.poll(() => event(item, 'transform-start')).toBeDefined();
        abort.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        try {
            await expect.poll(() => event(item, 'http-close')).toMatchObject({ finished: false });
            expect(event(item, 'http-finish')).toBeUndefined();
        } finally {
            gate.resolve('export const fixtureValue = 23;');
        }
        await expect.poll(() => event(item, 'transform-resolve')).toBeDefined();
    });

    it('does not activate in normal development or inject into a different fixture HTML', async () => {
        const disabled = await fixture('development');
        expect(await (await fetch(disabled.origin)).text()).not.toContain(STARTUP_DIAGNOSTIC_CLIENT);
        await (await fetch(`${disabled.origin}${STARTUP_DIAGNOSTIC_TARGET}`)).text();
        expect(disabled.events).toEqual([]);
        expect(disabled.server.environments.client.transformRequest).toBe(disabled.original);
        const enabled = await fixture();
        expect(await (await fetch(enabled.origin)).text()).toContain(STARTUP_DIAGNOSTIC_CLIENT);
        expect(await (await fetch(`${enabled.origin}/other.html`)).text()).not.toContain(STARTUP_DIAGNOSTIC_CLIENT);
    });

    it('bounds and validates renderer records without retaining arbitrary request content', async () => {
        const item = await fixture();
        const beat = {
            timeOrigin: Date.now(),
            sequence: 1,
            readyState: 'complete',
            entryStarted: true,
            bootstrapStarted: false,
            appRenderIssued: false,
            retryIssued: false,
            private: 'body-secret',
        };
        const post = (body: string): Promise<Response> =>
            fetch(`${item.origin}${STARTUP_DIAGNOSTIC_HEARTBEAT}?token=query-secret`, { method: 'POST', body });
        await post(JSON.stringify(beat));
        await post(JSON.stringify(beat));
        await post(JSON.stringify({ ...beat, sequence: 14 }));
        await post('oversized-secret'.repeat(100));
        expect(item.events.filter((value) => value.event === 'renderer-heartbeat')).toHaveLength(1);
        expect(JSON.stringify(item.events)).not.toMatch(/body-secret|query-secret|oversized-secret|private/);
        for (let index = 1; index <= 128; index += 1) {
            await post(JSON.stringify({ ...beat, timeOrigin: beat.timeOrigin + index }));
        }
        expect(item.events.filter((value) => value.event === 'renderer-heartbeat')).toHaveLength(128);
        for (let index = 0; index < 2_100; index += 1) {
            await item.server.environments.client.transformRequest(STARTUP_DIAGNOSTIC_TARGET);
        }
        expect(item.events).toHaveLength(4_096);
        expect(item.events.at(-1)?.eventId).toBe(4_096);
    }, 15_000);
});

describe('startup renderer diagnostics', () => {
    it('receives independent renderer heartbeats while the real entry module remains held', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const browser = await chromium.launch();
        browsers.push(browser);
        const page = await browser.newPage();
        const response = await page.goto(item.origin, { waitUntil: 'commit' });
        expect(response?.headers()['content-security-policy']).toBe(
            "default-src 'self'; script-src 'self'; connect-src 'self'"
        );
        try {
            await expect.poll(() => event(item, 'transform-start')).toBeDefined();
            await expect
                .poll(() => item.events.filter((value) => value.event === 'renderer-heartbeat').length, {
                    timeout: 8_000,
                })
                .toBeGreaterThan(1);
            expect(event(item, 'transform-resolve')).toBeUndefined();
            expect(event(item, 'renderer-heartbeat')).toMatchObject({
                entryStarted: false,
                bootstrapStarted: false,
                appRenderIssued: false,
                retryIssued: false,
            });
            expect(event(item, 'server-heartbeat')).toBeDefined();
        } finally {
            gate.resolve('export const fixtureValue = 23;');
        }
        await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'yes');
        await expect.poll(() => event(item, 'http-finish')).toMatchObject({ status: 200 });
    }, 20_000);
});
