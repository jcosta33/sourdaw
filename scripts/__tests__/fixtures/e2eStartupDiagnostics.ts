import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger, createServer, type Plugin, type ViteDevServer } from 'vite';

import { sourdawE2eStartupDiagnosticsPlugin, STARTUP_DIAGNOSTIC_TARGET } from '../../e2eStartupDiagnostics.ts';

export type Fixture = {
    root: string;
    server: ViteDevServer;
    origin: string;
    events: Array<Record<string, unknown>>;
    original: ViteDevServer['environments']['client']['transformRequest'];
};

export function deferred<Value>(): {
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

function isEvent(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function createFixture(mode = 'e2e', gate?: ReturnType<typeof deferred<string>>): Promise<Fixture> {
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
        if (isEvent(value)) {
            events.push(value);
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
    return result;
}

export function event(item: Fixture, name: string): Record<string, unknown> | undefined {
    return item.events.find((value) => value.event === name);
}
