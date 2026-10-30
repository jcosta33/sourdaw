import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'vite';

import { e2eViteClientPolicyPlugin } from '../../scripts/e2eViteClientPolicy';

const CLIENT = '/@vite/client';
const HTML = `<!doctype html><body style="color:rgb(30,31,32)"><output id="marker" class="client-probe">waiting</output>
<script type="module">
import { updateStyle, removeStyle, createHotContext } from '/@vite/client';
globalThis.__clientStyles = { updateStyle, removeStyle };
updateStyle('client-policy-proof', '.client-probe { color: rgb(1,2,3) }');
globalThis.__clientEvaluation = typeof createHotContext;
document.getElementById('marker').textContent = 'real client evaluated';
</script>`;

type SocketCall = { url: string; protocols: string | string[] | undefined; nativeInstance: boolean };

async function observeNativeConstructors(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const Native = WebSocket;
        const calls: SocketCall[] = [];
        Reflect.set(globalThis, '__nativeSocketCalls', calls);
        globalThis.WebSocket = new Proxy(Native, {
            construct(target, args, newTarget) {
                const socket: WebSocket = Reflect.construct(target, args, newTarget);
                calls.push({ url: String(args[0]), protocols: args[1], nativeInstance: socket instanceof Native });
                return socket;
            },
        });
    });
}

async function clientEffects(page: Page): Promise<SocketCall[]> {
    await expect(page.locator('#marker')).toHaveText('real client evaluated');
    await expect(page.locator('#marker')).toHaveCSS('color', 'rgb(1, 2, 3)');
    expect(await page.evaluate(() => Reflect.get(globalThis, '__clientEvaluation'))).toBe('function');
    await page.evaluate(() => {
        const styles = Reflect.get(globalThis, '__clientStyles') as { removeStyle: (id: string) => void };
        styles.removeStyle('client-policy-proof');
    });
    await expect(page.locator('#marker')).toHaveCSS('color', 'rgb(30, 31, 32)');
    return page.evaluate(() => Reflect.get(globalThis, '__nativeSocketCalls') as SocketCall[]);
}

test('ordinary repository E2E evaluates the real CSS client without constructing a Vite socket', async ({
    page,
}, info) => {
    await observeNativeConstructors(page);
    const response = await page.request.get(CLIENT);
    expect(response.status()).toBe(200);
    expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(resolve(import.meta.dirname, '../..'));
    await page.route('**/client-policy-proof.html', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
    await page.goto('/client-policy-proof.html');
    const calls = await clientEffects(page);
    expect(calls.filter((call) => call.protocols === 'vite-hmr')).toEqual([]);
    await info.attach('native-socket-calls', { body: JSON.stringify(calls), contentType: 'application/json' });
});

for (const profile of [
    { name: 'developer', mode: 'development' },
    { name: 'hardware opt-in', mode: 'e2e' },
]) {
    test(`${profile.name} retains the actual client and native Vite connection`, async ({ page }, info) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-client-policy-'));
        let server: Awaited<ReturnType<typeof createServer>> | undefined;
        try {
            mkdirSync(join(root, 'site'));
            writeFileSync(join(root, 'site/index.html'), HTML);
            server = await createServer({
                configFile: false,
                root: join(root, 'site'),
                cacheDir: join(root, 'cache'),
                mode: profile.mode,
                plugins: [e2eViteClientPolicyPlugin()],
                server: { host: '127.0.0.1', port: 0, hmr: true },
            });
            await server.listen();
            const address = server.httpServer?.address();
            if (address === null || address === undefined || typeof address === 'string') {
                throw new Error('Fixture server has no TCP address');
            }
            await observeNativeConstructors(page);
            await page.goto(`http://127.0.0.1:${address.port}/`);
            const calls = await clientEffects(page);
            const vite = calls.filter((call) => call.protocols === 'vite-hmr');
            expect(vite).toHaveLength(1);
            expect(vite[0]?.nativeInstance).toBe(true);
            await info.attach('native-socket-calls', { body: JSON.stringify(calls), contentType: 'application/json' });
        } finally {
            await page.close();
            await server?.close();
            rmSync(root, { recursive: true });
        }
    });
}
