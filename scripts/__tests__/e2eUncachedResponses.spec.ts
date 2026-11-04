// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer as createViteServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { sourdawE2eUncachedResponsesPlugin } from '../e2eUncachedResponses.ts';

/**
 * A real Vite dev server with only the uncached-responses plugin, over a
 * temp root holding one source module (Vite's transform middleware) and one
 * public file (its static file server): the two routes that write
 * validators the plugin must strip.
 */
const MODULE_PATH = '/entry.js';
const PUBLIC_PATH = '/asset.txt';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
    }
});

function makeServedRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-uncached-'));
    mkdirSync(join(root, 'public'));
    writeFileSync(join(root, 'entry.js'), 'export const entry = 1;\n');
    writeFileSync(join(root, 'public', 'asset.txt'), 'asset\n');
    cleanups.push(() => {
        rmSync(root, { recursive: true, force: true });
        return Promise.resolve();
    });
    return root;
}

async function serveWithPlugin(mode: string, root = makeServedRoot()): Promise<string> {
    const vite = await createViteServer({
        root,
        mode,
        configFile: false,
        logLevel: 'silent',
        appType: 'custom',
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true, hmr: false },
        plugins: [sourdawE2eUncachedResponsesPlugin()],
    });
    const server = createHttpServer(vite.middlewares);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(async () => {
        await new Promise((resolve) => server.close(resolve));
        await vite.close();
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP listener address');
    }
    return `http://127.0.0.1:${address.port}`;
}

type CacheHeaders = { status: number; cacheControl: string | null; etag: string | null; lastModified: string | null };

async function requestCacheHeaders(url: string, headers: Record<string, string> = {}): Promise<CacheHeaders> {
    const response = await fetch(url, { headers });
    await response.body?.cancel();
    return {
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
    };
}

describe('e2e uncached dev-server responses', () => {
    it.each([MODULE_PATH, PUBLIC_PATH])('serves %s with no-store and no validators in e2e mode', async (path) => {
        const origin = await serveWithPlugin('e2e');

        expect(await requestCacheHeaders(`${origin}${path}`)).toEqual({
            status: 200,
            cacheControl: 'no-store',
            etag: null,
            lastModified: null,
        });
    });

    it.each([MODULE_PATH, PUBLIC_PATH])(
        'answers a validator issued outside e2e mode for %s with the full body, never 304',
        async (path) => {
            // One root for both servers, so the validators match the e2e server's files.
            const root = makeServedRoot();
            const plain = await requestCacheHeaders(`${await serveWithPlugin('development', root)}${path}`);
            if (plain.etag === null) {
                throw new Error(`expected Vite to issue an ETag for ${path} outside e2e mode`);
            }
            const validators: Record<string, string> = { 'If-None-Match': plain.etag };
            if (plain.lastModified !== null) {
                validators['If-Modified-Since'] = plain.lastModified;
            }

            const revalidated = await requestCacheHeaders(`${await serveWithPlugin('e2e', root)}${path}`, validators);

            expect(revalidated.status).toBe(200);
            expect(revalidated.cacheControl).toBe('no-store');
        }
    );

    // Vite's public-file server passes these only as writeHead arguments, never through setHeader.
    it('keeps the entity headers Vite passes to writeHead for a public file, whole or ranged', async () => {
        const origin = await serveWithPlugin('e2e');

        const whole = await fetch(`${origin}${PUBLIC_PATH}`);
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-type')).toBe('text/plain');
        expect(whole.headers.get('content-length')).toBe(String('asset\n'.length));
        expect(await whole.text()).toBe('asset\n');

        const ranged = await fetch(`${origin}${PUBLIC_PATH}`, { headers: { Range: 'bytes=0-2' } });
        expect(ranged.status).toBe(206);
        expect(ranged.headers.get('content-range')).toBe(`bytes 0-2/${'asset\n'.length}`);
        expect(ranged.headers.get('accept-ranges')).toBe('bytes');
        expect(ranged.headers.get('cache-control')).toBe('no-store');
        expect(await ranged.text()).toBe('ass');
    });

    it('leaves Vite caching untouched outside e2e mode', async () => {
        const origin = await serveWithPlugin('development');
        const plain = await requestCacheHeaders(`${origin}${MODULE_PATH}`);

        expect(plain.cacheControl).toBe('no-cache');
        expect(plain.etag).not.toBeNull();
        expect(
            await requestCacheHeaders(`${origin}${MODULE_PATH}`, { 'If-None-Match': plain.etag ?? '' })
        ).toMatchObject({
            status: 304,
        });
    });
});
