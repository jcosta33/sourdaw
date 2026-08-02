/**
 * Static file server for the wasm leg of `benches/quantum.rs`.
 *
 * Two things it must do that a generic static server does not:
 *
 * 1. **Cross-origin isolation.** `COOP: same-origin` + `COEP: require-corp`
 *    make `self.crossOriginIsolated === true`, which is what un-clamps
 *    `performance.now()` in Chrome from 100 us to 5 us. A 100 us tick cannot
 *    resolve a device that costs 20 us per quantum, so without these headers
 *    every cheap device in the table would read as either 0 or 100 us. The
 *    harness asserts `crossOriginIsolated` before it measures and refuses to
 *    report numbers taken on a clamped timer.
 * 2. **Serve the repo root**, because the worklet imports the *generated*
 *    wasm-bindgen glue from `src/modules/AudioEngine/wasm/` — the copy that
 *    carries the `AudioWorkletGlobalScope` TextDecoder/TextEncoder polyfills —
 *    while the `_bg.wasm` binaries live under `public/wasm/`. Both are the
 *    committed artifacts production ships; nothing here is rebuilt.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
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
        const requested = url.pathname === '/' ? '/crates/daw-dsp/benches/wasm/index.html' : url.pathname;
        const filePath = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));

        if (!filePath.startsWith(root)) {
            response.writeHead(403).end('outside the served root');
            return;
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
