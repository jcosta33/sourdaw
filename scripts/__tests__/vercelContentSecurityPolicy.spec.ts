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
 * exactly, source for source — every `connect-src` entry there is a host this
 * renderer actually requests, evidenced by a `fetch`/`Worker`/`audioWorklet`
 * call site (see that file's own comment for the per-source justification).
 * The hosted deployment adds exactly one directive Electron has no use for:
 * `frame-ancestors 'none'`, because a `webview` is never framed by a foreign
 * origin but a public web page can be, and that is a clickjacking surface
 * `Content-Security-Policy` closes where `X-Frame-Options` cannot (multiple
 * ancestors, no `'self'`-only nuance).
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
        // web page can be.
        expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    });

    it('admits no eval and no inline script', () => {
        expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
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
        // (Ollama/LM Studio) — `configureCloudProvider.ts` requires exactly
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
        expect(directives.get('connect-src')).toEqual(ELECTRON_CONNECT_SRC);
    });

    it('carries the same style/img/media/base-uri/frame-src/form-action directives as the Electron shell', () => {
        // Same renderer bundle, same non-origin-specific requirements.
        expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
        expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
        expect(directives.get('media-src')).toEqual(["'self'", 'data:', 'blob:']);
        expect(directives.get('frame-src')).toEqual(["'none'"]);
        expect(directives.get('form-action')).toEqual(["'self'"]);
    });
});
