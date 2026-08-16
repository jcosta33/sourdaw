/**
 * The `app://sourdaw` privileged scheme (REQ-002).
 *
 * The renderer is the unmodified web build. It asks for root-absolute URLs —
 * `/wasm/daw-dsp/daw_dsp_bg.wasm`, `/audio/worklets/*.js`, `/samples/**` — so
 * the shell needs an origin with a real path root, not `file://`. It also needs
 * that origin to be cross-origin isolated, because the DSP worklets share
 * memory: without COOP/COEP the renderer has no `SharedArrayBuffer` and the
 * audio graph cannot start.
 *
 * `file://` gives neither. A custom scheme registered as `standard` + `secure`
 * gives both, and lets every response carry the isolation headers and the same
 * Content-Security-Policy Tauri ships today.
 */
import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, net, protocol } from 'electron';

export const APP_SCHEME = 'app';
export const APP_HOST = 'sourdaw';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/**
 * The production CSP from `src-tauri/tauri.conf.json`
 * (`app.security.csp`), with the Tauri-only schemes removed.
 *
 * `ipc:` / `http://ipc.localhost` name Tauri's IPC transport and `asset:` /
 * `http://asset.localhost` name Tauri's asset protocol. Neither exists in the
 * Electron shell — the shell serves everything from this origin, which `'self'`
 * already covers — so carrying them here would widen the policy past what any
 * request can use.
 *
 * `http://[::1]:*` is dropped for a different reason: Chromium rejects it as an
 * invalid source and logs a console error on every page load. A rejected source
 * grants nothing, so dropping it costs no reach — an `http://[::1]:port` fetch
 * is refused either way — and it keeps the console readable, which is the only
 * place a real policy violation shows up. (The Tauri config still carries the
 * token; that is a defect in the shipped policy, filed separately.)
 *
 * Every other directive is byte-identical to the Tauri policy on purpose: the
 * renderer is the same build, so a directive that differs is a behavioural
 * difference between the two shells.
 */
export const PRODUCTION_CSP = [
    "default-src 'self'",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* https:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "form-action 'self'",
].join('; ');

/**
 * Headers every `app://` response carries.
 *
 * COOP + COEP are what make the renderer cross-origin isolated. CORP is on
 * every response because COEP `require-corp` rejects any subresource that does
 * not opt in — including this origin's own `/wasm/**`, which is fetched from
 * worklet and worker contexts.
 */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': PRODUCTION_CSP,
};

export type ContentRoots = {
    /** The Vite build output: `index.html`, `assets/**`, `wasm/**`, `audio/worklets/**`. */
    readonly distDir: string;
    /** Bundled audio content, shipped outside the asar as a packaged resource. */
    readonly samplesDir: string;
};

/**
 * Register the scheme's privileges.
 *
 * Must run before `app.whenReady()` — Chromium reads the privileged-scheme
 * table once, while the renderer process registry is built, and a scheme
 * registered afterwards is an ordinary opaque one: no `fetch`, no
 * `SharedArrayBuffer`, no module scripts. The main entry is ESM, so this is
 * called at module top level, ahead of the first `await`; anything after an
 * await may already be past `ready`.
 */
export const registerAppScheme = (): void => {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: APP_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                stream: true,
                codeCache: true,
            },
        },
    ]);
};

/**
 * Where the shell reads content from.
 *
 * Packaged: `dist/` is inside the asar and `samples/` sits beside it in
 * `resources/`, unpacked, because the sample loader hands real filesystem paths
 * to the audio backend. Unpackaged (`pnpm desktop:dev`): both come from the
 * checkout, since `process.resourcesPath` then points into Electron's own
 * bundle and holds nothing of ours.
 */
export const resolveContentRoots = (): ContentRoots => {
    if (app.isPackaged) {
        return {
            distDir: join(app.getAppPath(), 'dist'),
            samplesDir: join(process.resourcesPath, 'samples'),
        };
    }

    const repoRoot = resolve(dirname(import.meta.dirname), '..');
    return {
        distDir: join(repoRoot, 'dist'),
        samplesDir: join(repoRoot, 'public', 'samples'),
    };
};

/**
 * Join a request path onto a root without letting it escape.
 *
 * A custom protocol handler is a file server, so it inherits a file server's
 * one classic defect. `../` in the URL, percent-encoded or not, must not reach
 * outside the root — the check is on the resolved path, because normalisation
 * is the only thing that sees through the encoding.
 */
const resolveWithinRoot = (root: string, requestPath: string): string | undefined => {
    let decoded: string;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        return undefined;
    }

    const candidate = normalize(join(root, decoded));
    const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
    if (candidate !== root && !candidate.startsWith(rootWithSeparator)) {
        return undefined;
    }
    return candidate;
};

/**
 * Map a request pathname onto a file.
 *
 * `/samples/**` is the only prefix that leaves `dist/`. Everything else is a
 * build artifact. A path with no file extension that misses is treated as a
 * client route and served `index.html`, which is what the router expects on a
 * reload; a miss that looks like an asset stays a 404, so a broken `/wasm/**`
 * URL fails loudly instead of parsing HTML as wasm.
 */
export const resolveRequestPath = (roots: ContentRoots, pathname: string): string | undefined => {
    const normalizedPathname = pathname === '' || pathname === '/' ? '/index.html' : pathname;

    if (normalizedPathname.startsWith('/samples/')) {
        return resolveWithinRoot(roots.samplesDir, normalizedPathname.slice('/samples/'.length));
    }

    const filePath = resolveWithinRoot(roots.distDir, normalizedPathname.slice(1));
    if (filePath === undefined) {
        return undefined;
    }
    if (existsSync(filePath)) {
        return filePath;
    }

    const lastSegment = normalizedPathname.slice(normalizedPathname.lastIndexOf('/') + 1);
    return lastSegment.includes('.') ? filePath : join(roots.distDir, 'index.html');
};

const withIsolationHeaders = (response: Response): Response => {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
        headers.set(name, value);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
};

/** Install the `app://` handler. Must run after `app.whenReady()`. */
export const handleAppProtocol = (roots: ContentRoots): void => {
    protocol.handle(APP_SCHEME, async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== APP_HOST) {
            return withIsolationHeaders(new Response('Not found', { status: 404 }));
        }

        const filePath = resolveRequestPath(roots, url.pathname);
        if (filePath === undefined) {
            return withIsolationHeaders(new Response('Forbidden', { status: 403 }));
        }

        try {
            // `net.fetch` over `file://` rather than `readFile`: it streams, and
            // it answers Range requests, which `<audio>`/`<video>` seeking needs.
            return withIsolationHeaders(await net.fetch(pathToFileURL(filePath).toString()));
        } catch {
            return withIsolationHeaders(new Response('Not found', { status: 404 }));
        }
    });
};
