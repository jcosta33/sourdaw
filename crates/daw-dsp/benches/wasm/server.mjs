/**
 * Static file server for the wasm leg of `benches/quantum.rs`.
 *
 * Three things it must do that a generic static server does not:
 *
 * 1. **Cross-origin isolation.** `COOP: same-origin` + `COEP: require-corp`
 *    make `self.crossOriginIsolated === true`, which is what makes
 *    `SharedArrayBuffer` constructible. That is not a nicety here, it is the
 *    whole clock: Chrome exposes no `performance` inside an
 *    `AudioWorkletGlobalScope`, so the worklet's only sub-millisecond time
 *    source is a counter a spinning worker writes into shared memory. Without
 *    these headers there is no `SharedArrayBuffer`, and therefore no way to
 *    time a quantum from inside a worklet at all. The harness asserts
 *    `crossOriginIsolated` before it measures.
 *
 *    Cross-origin isolation also un-clamps `performance.now()` from 100 us to
 *    5 us, which matters for the *page*-side calibration and cross-checks — but
 *    not for the per-quantum figures, which never touch `performance`.
 * 2. **Serve the repo root**, because the worklet imports the *generated*
 *    wasm-bindgen glue from `src/modules/AudioEngine/wasm/` — the copy that
 *    carries the `AudioWorkletGlobalScope` TextDecoder/TextEncoder polyfills —
 *    while the `_bg.wasm` binaries live under `public/wasm/`. Both are the
 *    committed artifacts production ships; nothing here is rebuilt.
 * 3. **Strip types from `.ts` on the way out**, so the harness can import the
 *    *real shipped* `grandBouleProcessor.ts` and time the actual
 *    `readBlockAcquire` that runs on the audio thread in production, rather
 *    than a reproduction of it. `node:module`'s `stripTypeScriptTypes` is a
 *    type eraser, not a compiler: it rewrites nothing and emits no helpers, so
 *    what the browser runs is the shipped source minus its annotations.
 *    Extensionless relative specifiers are resolved to `.ts` the way the
 *    bundler resolves them.
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.map': 'application/json; charset=utf-8',
};

/**
 * @param {string} repoRoot absolute path served at `/`
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export function startServer(repoRoot) {
    const root = resolve(repoRoot);

    const server = createServer((request, response) => {
        // Cross-origin isolation, and the CORP header every subresource needs
        // for COEP: require-corp to let it load at all.
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        response.setHeader('Cache-Control', 'no-store');

        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/favicon.ico') {
            response.writeHead(204).end();
            return;
        }
        const requested = url.pathname === '/' ? '/crates/daw-dsp/benches/wasm/index.html' : url.pathname;
        let filePath = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));

        if (!filePath.startsWith(root)) {
            response.writeHead(403).end('outside the served root');
            return;
        }

        // Extensionless relative specifier — the form the app's TypeScript uses
        // for its own modules. Resolve it the way the bundler does.
        if (extname(filePath) === '' && existsSync(`${filePath}.ts`)) {
            filePath = `${filePath}.ts`;
        }

        let stats;
        try {
            stats = statSync(filePath);
        } catch {
            response.writeHead(404).end(`not found: ${requested}`);
            return;
        }
        if (!stats.isFile()) {
            response.writeHead(404).end(`not a file: ${requested}`);
            return;
        }

        if (extname(filePath) === '.ts') {
            const stripped = stripTypeScriptTypes(readFileSync(filePath, 'utf8'), { mode: 'strip' });
            const body = Buffer.from(stripped, 'utf8');
            response.writeHead(200, {
                'Content-Type': 'text/javascript; charset=utf-8',
                'Content-Length': String(body.byteLength),
            });
            response.end(body);
            return;
        }

        response.writeHead(200, {
            'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
            'Content-Length': String(stats.size),
        });
        createReadStream(filePath).pipe(response);
    });

    return new Promise((resolveStart) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            resolveStart({
                origin: `http://localhost:${port}`,
                close: () =>
                    new Promise((resolveClose) => {
                        server.close(() => resolveClose(undefined));
                    }),
            });
        });
    });
}
