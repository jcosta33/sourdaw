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
 * gives both, and lets every response carry the isolation headers and this
 * shell's Content-Security-Policy.
 */
import { statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, net, protocol } from 'electron';

export const APP_SCHEME = 'app';
export const APP_HOST = 'sourdaw';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/**
 * The Content-Security-Policy every `app://` response carries.
 *
 * The document-level directives — `script-src`, `style-src`, `worker-src`,
 * `object-src`, `base-uri`, `frame-src`, `form-action` — are held identical to
 * the ones the Tauri-era config shipped, on purpose: the renderer is the same
 * web build across the shell change, so a difference there is a behavioural
 * difference inside one application. The origin-level and connection-level
 * directives are this shell's own decision, because the two shells did not
 * have the same origins and did not make the same requests.
 *
 * `ipc:` / `http://ipc.localhost` named Tauri's IPC transport and `asset:` /
 * `http://asset.localhost` named its asset protocol. Neither exists in the
 * Electron shell — the shell serves everything from this origin, which `'self'`
 * already covers — so carrying them here would widen the policy past what any
 * request can use.
 *
 * `http://[::1]:*` is not carried: Chromium rejects it as an invalid source and
 * logs a console error on every page load. A rejected source grants nothing, so
 * omitting it costs no reach — an `http://[::1]:port` fetch is refused either
 * way — and it keeps the console readable, which is the only place a real
 * policy violation shows up.
 *
 * `connect-src` enumerates this shell's renderer egress and nothing wider. A
 * bare `https:` is an open exfiltration channel for any injected script and
 * must never return, so a source belongs here only when renderer code in this
 * build actually fetches it:
 *
 * - Loopback HTTP, for a user-run OpenAI-compatible LLM server. That is the
 *   only provider the renderer requests itself: a hosted `https:` provider is
 *   bound to a compiled adapter and streamed by the native provider gateway
 *   over IPC, a transport no CSP directive governs. `configureCloudProvider`
 *   accepts a third loopback spelling, `[::1]`, that this policy cannot express
 *   for the reason above, so such a base URL passes application validation and
 *   is then refused here.
 * - Hugging Face and its CDN redirect hosts, for Kokoro and WebLLM model
 *   artifacts.
 * - `raw.githubusercontent.com`, for the MLC wasm runtime. It is as
 *   multi-tenant as any public bucket host and is admitted only because
 *   `webLlmArtifactAdmission` pins every artifact it serves by sha256.
 *
 * A host with no consumer stays out however plausible its future use, because a
 * shared multi-tenant origin admitted "for later" is an attacker-registrable
 * exfiltration endpoint in the meantime. DDSP checkpoints are the live example:
 * they sit on `storage.googleapis.com`, one origin fronting every public GCS
 * bucket, and DDSP rendering is a stub in this build that performs no egress.
 * The source returns path-scoped when DDSP rendering ships.
 */
export const PRODUCTION_CSP = [
    "default-src 'self'",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
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
/**
 * Total, not merely `ENOENT`-tolerant.
 *
 * `throwIfNoEntry: false` suppresses `ENOENT` and `ENOTDIR` and nothing else:
 * `statSync` still throws on `EACCES`, `ELOOP` and `ENAMETOOLONG`, and it
 * throws `ERR_INVALID_ARG_VALUE` for a path containing a NUL byte — which is
 * reachable straight from the URL, since `app://sourdaw/a%00.js` decodes to
 * one. Both call sites sit outside the handler's `try`, so a throw here would
 * reject a request that has to answer 404. This is the one function in the
 * shell that touches attacker-influenceable input; an unreadable, cyclic,
 * over-long or malformed path is not a file, and that is the whole answer.
 */
const isFile = (filePath: string): boolean => {
    try {
        return statSync(filePath, { throwIfNoEntry: false })?.isFile() === true;
    } catch {
        return false;
    }
};

export const resolveRequestPath = (roots: ContentRoots, pathname: string): string | undefined => {
    const normalizedPathname = pathname === '' || pathname === '/' ? '/index.html' : pathname;

    if (normalizedPathname.startsWith('/samples/')) {
        return resolveWithinRoot(roots.samplesDir, normalizedPathname.slice('/samples/'.length));
    }

    const filePath = resolveWithinRoot(roots.distDir, normalizedPathname.slice(1));
    if (filePath === undefined) {
        return undefined;
    }
    // `isFile`, not "exists": `/assets` and `/wasm` are real directories, and a
    // directory handed to `net.fetch` over `file://` answers with a generated
    // listing. That is a 200 with the wrong body — a route collision would ship
    // an HTML index page where the router expects `index.html`, and the failure
    // would surface as a parse error far from its cause.
    if (isFile(filePath)) {
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
        // `host`, not `hostname`: they differ when a port is present, so
        // `app://sourdaw:1/...` would pass a `hostname` check and be served as
        // if it were the app origin. Chromium treats it as a distinct origin,
        // which is exactly the confusion worth refusing.
        if (url.host !== APP_HOST) {
            return withIsolationHeaders(new Response('Not found', { status: 404 }));
        }

        const filePath = resolveRequestPath(roots, url.pathname);
        if (filePath === undefined) {
            return withIsolationHeaders(new Response('Forbidden', { status: 403 }));
        }
        // Second directory guard, for the `/samples/**` root and for the
        // extension-bearing miss that `resolveRequestPath` deliberately lets
        // through so it can 404 here rather than fall back to `index.html`.
        if (!isFile(filePath)) {
            return withIsolationHeaders(new Response('Not found', { status: 404 }));
        }

        try {
            // `net.fetch` over `file://` rather than `readFile`: it streams the
            // body instead of buffering the whole file, which matters for wasm
            // and for sample payloads. It does not implement Range — Electron
            // drops request headers on a `file://` fetch — so a media element
            // seeking inside an `app://` URL re-reads from the start. Acceptable
            // while the shell serves no long media over this scheme; revisit
            // with an explicit Range implementation if it ever does.
            return withIsolationHeaders(await net.fetch(pathToFileURL(filePath).toString()));
        } catch {
            return withIsolationHeaders(new Response('Not found', { status: 404 }));
        }
    });
};
