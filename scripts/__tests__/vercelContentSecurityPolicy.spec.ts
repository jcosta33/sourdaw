/**
 * The Content-Security-Policy the hosted web build (app.sourdaw.studio) ships.
 *
 * `vercel.json` `headers` is the only server-side mechanism the Vercel
 * deployment has for setting response headers — there is no server process to
 * attach them at request time the way `electron/protocol.ts` does for the
 * `app://` scheme. This pins the policy in the deployment config itself.
 *
 * The renderer bundle is the same web build in both shells, so the directive
 * values below are pinned to mirror `PRODUCTION_CSP` in `electron/protocol.ts`
 * source for source wherever the two shells share a constraint — every
 * `connect-src` entry there is a host this renderer actually requests,
 * evidenced by a `fetch`/`Worker`/`audioWorklet` call site (see that file's
 * own comment for the per-source justification). The hosted deployment
 * departs from `PRODUCTION_CSP` on the entries this build actually needs
 * that `electron/protocol.ts` leaves unchanged: `frame-ancestors 'self'`,
 * because a `webview` is never framed by a foreign origin but a public web
 * page can be, and that is a clickjacking surface `Content-Security-Policy`
 * closes where `X-Frame-Options` cannot (multiple ancestors, no `'self'`-only
 * nuance); `frame-src 'self'`, so `src/app/browserDisplayScaleHost.ts` can
 * frame the same-origin document it hosts for every top-level web session;
 * `script-src`'s `blob:`, so `@grame/faustwasm` can load its
 * `URL.createObjectURL` compiler module and register its blob-URL
 * `AudioWorklet`s; and `connect-src`'s `[::1]` loopback entry, which
 * `configureCloudProvider.ts` and `providerAdapterRegistry.ts` accept as a
 * loopback provider host and Electron's list omits.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type VercelHeaderEntry = { key: string; value: string };
type VercelHeaderRule = { source: string; headers: VercelHeaderEntry[] };
type VercelConfig = { headers?: VercelHeaderRule[] };

const MAGENTA_DDSP_CSP_SOURCE = 'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/';

/**
 * `PRODUCTION_CSP`'s `connect-src`, copied here rather than imported.
 *
 * `electron/protocol.ts` imports Electron's `app`/`net`/`protocol` at module
 * load time, so pulling the constant in requires the same `vi.mock('electron',
 * ...)` `electron/__tests__/webviewSecurity.spec.ts` carries — coupling a
 * deployment-config test to Electron's module surface for one string. The
 * literal list is what that spec itself asserts `PRODUCTION_CSP` equals, so
 * this pins the same evidence without the import.
 */
const ELECTRON_CONNECT_SRC = [
    "'self'",
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://huggingface.co',
    'https://*.huggingface.co',
    'https://*.hf.co',
    'https://raw.githubusercontent.com',
    MAGENTA_DDSP_CSP_SOURCE,
];

/**
 * The hosted deployment's own `connect-src`: `ELECTRON_CONNECT_SRC` with the
 * `[::1]` loopback literal inserted after `127.0.0.1`. `configureCloudProvider.ts`
 * and `providerAdapterRegistry.ts` both accept `[::1]` as a loopback provider
 * host alongside `localhost`/`127.0.0.1`; Electron's list omits it.
 */
const HOSTED_CONNECT_SRC = ELECTRON_CONNECT_SRC.flatMap((source) =>
    source === 'http://127.0.0.1:*' ? [source, 'http://[::1]:*'] : [source]
);

function readVercelConfig(): VercelConfig {
    const raw = readFileSync(join(import.meta.dirname, '../../vercel.json'), 'utf8');
    return JSON.parse(raw) as VercelConfig;
}

function findCatchAllHeaders(config: VercelConfig): VercelHeaderEntry[] {
    const rule = config.headers?.find((entry) => entry.source === '/(.*)');
    if (rule === undefined) {
        throw new Error('vercel.json carries no headers rule for "/(.*)"');
    }
    return rule.headers;
}

function findHeaderValue(headers: VercelHeaderEntry[], key: string): string {
    const entry = headers.find((header) => header.key.toLowerCase() === key.toLowerCase());
    if (entry === undefined) {
        throw new Error(`vercel.json headers carry no "${key}" entry`);
    }
    return entry.value;
}

function parseCsp(policy: string): Map<string, string[]> {
    const directives = new Map<string, string[]>();
    for (const entry of policy.split(';')) {
        const [name, ...sources] = entry.trim().split(/\s+/u);
        if (name !== undefined && name !== '') {
            directives.set(name, sources);
        }
    }
    return directives;
}

describe('the hosted web build Content-Security-Policy', () => {
    const config = readVercelConfig();
    const headers = findCatchAllHeaders(config);
    const csp = findHeaderValue(headers, 'Content-Security-Policy');
    const directives = parseCsp(csp);

    it('still carries the isolation headers the audio engine needs', () => {
        expect(findHeaderValue(headers, 'Cross-Origin-Opener-Policy')).toBe('same-origin');
        expect(findHeaderValue(headers, 'Cross-Origin-Embedder-Policy')).toBe('require-corp');
    });

    it('closes the directives an injected document would reach for', () => {
        expect(directives.get('default-src')).toEqual(["'self'"]);
        expect(directives.get('object-src')).toEqual(["'none'"]);
        expect(directives.get('base-uri')).toEqual(["'self'"]);
        // The one directive Electron's `PRODUCTION_CSP` carries no equivalent
        // of: a `webview` is never framed by a foreign origin, but a public
        // web page can be. `'self'`, not `'none'`, because
        // `browserDisplayScaleHost.ts` frames the same-origin document it
        // hosts for every top-level web session.
        expect(directives.get('frame-ancestors')).toEqual(["'self'"]);
    });

    it('admits no eval and no inline script', () => {
        // `blob:` is required, not merely `'self'`: `@grame/faustwasm`
        // (`node_modules/@grame/faustwasm/dist/esm/index.js`) loads its
        // compiler module and every Faust `AudioWorklet` processor from a
        // `URL.createObjectURL` blob, and a blob URL is never same-origin
        // under `script-src`.
        expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", 'blob:']);
        expect([...directives.values()].flat()).not.toContain("'unsafe-eval'");
        expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
    });

    it('scopes worker-src to bundled workers -- the app creates no blob workers', () => {
        // Every `new Worker(...)` in `src/` loads a same-origin module URL
        // (`new URL('./x.worker.ts', import.meta.url)`), never
        // `URL.createObjectURL`, so `worker-src` needs no `blob:` source.
        expect(directives.get('worker-src')).toEqual(["'self'"]);
    });

    it('admits only the enumerated provider and model hosts on connect-src', () => {
        // Each source is a host renderer code in this build actually
        // fetches: loopback HTTP for a user-run OpenAI-compatible LLM server
        // (Ollama/LM Studio) — `configureCloudProvider.ts` and
        // `providerAdapterRegistry.ts` accept exactly
        // `localhost`/`127.0.0.1`/`[::1]` for unauthenticated HTTP, and a
        // hosted `https:` provider is refused outright on the web build
        // (`setCloudProviderConfig.ts` gates every adapter-backed provider,
        // Anthropic included, behind `isDesktopRuntime()`, so there is no
        // hosted-provider `fetch` for this deployment to allow); Hugging
        // Face plus its CDN redirect hosts for Kokoro/WebLLM model
        // artifacts; raw.githubusercontent.com for the MLC wasm runtime; and
        // only the exact Magenta DDSP checkpoint path whose artifacts are
        // sha256-pinned. A host with no consumer stays out, and a bare
        // `https:` is an open exfiltration channel that must never return.
        // The wildcard port on every loopback entry is a deliberately
        // accepted risk on this public origin rather than an Electron-only
        // convenience: a user-run local server binds whatever port it
        // chooses, so the port cannot be narrowed further without breaking
        // the feature.
        expect(directives.get('connect-src')).toEqual(HOSTED_CONNECT_SRC);
    });

    it('carries the same style/img/media/base-uri/form-action directives as the Electron shell', () => {
        // Same renderer bundle, same non-origin-specific requirements.
        expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
        expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
        expect(directives.get('media-src')).toEqual(["'self'", 'data:', 'blob:']);
        expect(directives.get('form-action')).toEqual(["'self'"]);
    });

    it('frames only its own same-origin display-scale host document', () => {
        // `src/app/browserDisplayScaleHost.ts` sets `frame.src =
        // window.location.href` to host the display-scale iframe every
        // top-level web session creates (`resolveAppComposition.ts` resolves
        // `browser-host` on production web) — `'self'`, not `'none'`, is
        // required for that iframe to load at all.
        expect(directives.get('frame-src')).toEqual(["'self'"]);
    });
});
