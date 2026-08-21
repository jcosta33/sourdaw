/**
 * The webview security boundary of the Electron shell (AC-003).
 *
 * Pins the four things the Electron shell decides for itself and that are
 * each silent when wrong:
 *
 * - the Content-Security-Policy every `app://` response carries — both the
 *   policy string and its attachment, driven through the registered handler,
 * - the permission allow-list,
 * - the sender-origin check every IPC handler runs, exercised with a spoofed
 *   frame URL rather than only with the honest one,
 * - the navigation lockdown: `will-navigate` denies off-origin, and
 *   `windowOpenHandler` denies every target.
 *
 * The command sets are pinned in `commands.spec.ts`, where they are re-derived
 * from Rust.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { net, protocol } from 'electron';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
    APP_ORIGIN,
    DDSP_CHECKPOINT_CSP_SOURCE,
    DDSP_CORS_READABLE_OUTSIDE_CSP_PROBE_URL,
    handleAppProtocol,
    ISOLATION_HEADERS,
    isUrlAllowedByCspSource,
    PRODUCTION_CSP,
    type ContentRoots,
} from '../protocol.js';
import { withTrustedSender, type SenderFrameCarrier } from '../router.js';
import {
    ALLOWED_PERMISSIONS,
    decideWindowOpen,
    FILE_SYSTEM_PERMISSION,
    isNavigationAllowed,
    trustedFrameGuard,
} from '../security.js';

// `protocol.ts` imports Electron's `app`, `net` and `protocol` at load time.
// `vi.mock` is hoisted above the imports, so the real module is never reached.
vi.mock('electron', () => ({
    app: { isPackaged: false, getAppPath: () => '/app' },
    net: { fetch: vi.fn() },
    protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
}));

const DEV_SERVER = 'http://localhost:5173';
const origins = [APP_ORIGIN, DEV_SERVER];

const parseCsp = (policy: string): Map<string, string[]> => {
    const directives = new Map<string, string[]>();
    for (const entry of policy.split(';')) {
        const [name, ...sources] = entry.trim().split(/\s+/u);
        if (name !== undefined && name !== '') {
            directives.set(name, sources);
        }
    }
    return directives;
};

/** Every production TypeScript source under a directory, concatenated. */
const readProductionTypescript = (directory: string): string =>
    readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.name !== '__tests__')
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                return [readProductionTypescript(path)];
            }
            if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
                return [];
            }
            if (entry.name.includes('.spec.') || entry.name.includes('.stories.') || entry.name.includes('.e2e.')) {
                return [];
            }
            return [readFileSync(path, 'utf8')];
        })
        .join('\n');

describe('the production Content-Security-Policy', () => {
    const directives = parseCsp(PRODUCTION_CSP);

    it('admits no eval and no inline script', () => {
        expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
        expect([...directives.values()].flat()).not.toContain("'unsafe-eval'");
        expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
    });

    it('admits only bundled workers and the enumerated provider and model hosts', () => {
        expect(directives.get('worker-src')).toEqual(["'self'"]);
        // This shell's renderer egress, and nothing wider. Each source is a
        // host renderer code in this build actually fetches: loopback HTTP for
        // a user-run OpenAI-compatible LLM server (a hosted https provider
        // streams through the native gateway over IPC, which no CSP directive
        // governs), Hugging Face plus its CDN redirect hosts for Kokoro/WebLLM
        // model artifacts, and raw.githubusercontent.com for the MLC wasm
        // runtime, whose artifacts are sha256-pinned. A host with no consumer
        // stays out, and a bare `https:` is an open exfiltration channel that
        // must never return.
        expect(directives.get('connect-src')).toEqual([
            "'self'",
            'http://localhost:*',
            'http://127.0.0.1:*',
            'https://huggingface.co',
            'https://*.huggingface.co',
            'https://*.hf.co',
            'https://raw.githubusercontent.com',
            'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/',
        ]);
        expect(directives.get('connect-src')).not.toContain('https:');
        expect([...directives.values()].flat()).not.toContain('https:');
        expect([...directives.values()].flat()).not.toContain('http:');
        expect([...directives.values()].flat()).not.toContain('ws:');
        expect(directives.get('connect-src')).not.toContain('https://storage.googleapis.com');
        // `worker-src 'self'` refuses a blob: worker at runtime, on a machine
        // in front of a musician. This scan fails the same mistake at test
        // time instead.
        expect(readProductionTypescript('src')).not.toMatch(/new\s+Worker\s*\(\s*URL\.createObjectURL/gu);
    });

    it('refuses the exact CORS-readable outside-prefix probe that a wider checkpoint source would admit', () => {
        expect(DDSP_CORS_READABLE_OUTSIDE_CSP_PROBE_URL).toBe(
            'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_2bar_small/config.json'
        );
        expect(isUrlAllowedByCspSource(DDSP_CHECKPOINT_CSP_SOURCE, DDSP_CORS_READABLE_OUTSIDE_CSP_PROBE_URL)).toBe(
            false
        );
        expect(
            isUrlAllowedByCspSource(
                'https://storage.googleapis.com/magentadata/js/checkpoints/',
                DDSP_CORS_READABLE_OUTSIDE_CSP_PROBE_URL
            )
        ).toBe(true);
    });

    it('closes the directives an injected document would reach for', () => {
        expect(directives.get('object-src')).toEqual(["'none'"]);
        expect(directives.get('base-uri')).toEqual(["'self'"]);
        expect(directives.get('frame-src')).toEqual(["'none'"]);
        expect(directives.get('form-action')).toEqual(["'self'"]);
    });

    it('sits in the header set the shell attaches, alongside the isolation headers', () => {
        expect(ISOLATION_HEADERS['Content-Security-Policy']).toBe(PRODUCTION_CSP);
        expect(ISOLATION_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
        expect(ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    });
});

/**
 * A correct policy in a constant nothing attaches is a policy that is not
 * applied, and in Electron there is no second chance: the header is per
 * response, with no webview-level fallback, so a response that leaves the
 * handler without it carries no policy at all rather than a weaker one. These
 * cases therefore drive the handler `handleAppProtocol` registers and read the
 * headers off the `Response` it returns.
 */
describe('the policy the protocol handler attaches', () => {
    let roots: ContentRoots;

    beforeAll(() => {
        const distDir = mkdtempSync(join(tmpdir(), 'sourdaw-csp-dist-'));
        writeFileSync(join(distDir, 'index.html'), '<!doctype html>');
        roots = { distDir, samplesDir: mkdtempSync(join(tmpdir(), 'sourdaw-csp-samples-')) };
    });

    const installedHandler = (): ((request: Request) => Promise<Response> | Response) => {
        const handle = vi.mocked(protocol.handle);
        handle.mockClear();
        handleAppProtocol(roots);

        const registration = handle.mock.calls.at(-1);
        if (registration === undefined) {
            throw new Error('handleAppProtocol registered no handler');
        }
        return registration[1];
    };

    const expectPolicy = (response: Response): void => {
        expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP);
        expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
        expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
        expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    };

    it('carries it on the response that serves a file', async () => {
        // `net.fetch` answers over `file://` and sends none of these headers, so
        // whatever it returns has to be re-wrapped before it reaches Chromium.
        vi.mocked(net.fetch).mockResolvedValue(new Response('<!doctype html>', { status: 200 }));

        const response = await installedHandler()(new Request(`${APP_ORIGIN}/index.html`));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('<!doctype html>');
        expectPolicy(response);
    });

    it('carries it on every refusal the handler can answer with', async () => {
        vi.mocked(net.fetch).mockResolvedValue(new Response('<!doctype html>', { status: 200 }));
        const handler = installedHandler();

        // Wrong host: `app://sourdaw:1` is a distinct origin to Chromium.
        const foreignHost = await handler(new Request('app://sourdaw:1/index.html'));
        expect(foreignHost.status).toBe(404);
        expectPolicy(foreignHost);

        // Unresolvable path. Chromium normalises `..` out of the URL before the
        // handler sees it, so the reachable way into this branch is an encoding
        // `decodeURIComponent` refuses.
        const unresolvable = await handler(new Request(`${APP_ORIGIN}/%zz`));
        expect(unresolvable.status).toBe(403);
        expectPolicy(unresolvable);

        // Extension-bearing miss: a 404, never the SPA fallback.
        const missingAsset = await handler(new Request(`${APP_ORIGIN}/wasm/absent.wasm`));
        expect(missingAsset.status).toBe(404);
        expectPolicy(missingAsset);

        // The read itself failing is the last path out of the handler.
        vi.mocked(net.fetch).mockRejectedValueOnce(new Error('EIO'));
        const readFailure = await handler(new Request(`${APP_ORIGIN}/index.html`));
        expect(readFailure.status).toBe(404);
        expectPolicy(readFailure);
    });
});

describe('the permission allow-list', () => {
    it('grants only the capabilities the renderer actually uses', () => {
        expect([...ALLOWED_PERMISSIONS].sort()).toEqual([
            'clipboard-sanitized-write',
            'media',
            'midi',
            'midiSysex',
            'persistent-storage',
            'speaker-selection',
        ]);
    });

    it('does not grant the File System Access API by permission string alone', () => {
        expect(ALLOWED_PERMISSIONS.has(FILE_SYSTEM_PERMISSION)).toBe(false);
    });

    it('does not grant the permissions a DAW shell has no use for', () => {
        for (const permission of ['geolocation', 'notifications', 'display-capture', 'openExternal', 'pointerLock']) {
            expect(ALLOWED_PERMISSIONS.has(permission)).toBe(false);
        }
    });
});

describe('the sender-origin check every handler runs', () => {
    const frame = (url: string | undefined): SenderFrameCarrier => ({
        senderFrame: url === undefined ? null : { url },
    });
    // The export the shell installs, not a re-statement of it. Composing the
    // check here instead would leave the one line that actually guards every
    // handler unreachable by any spec, and these assertions would be observing
    // a copy of it.
    const guard = trustedFrameGuard(() => origins);
    const handler = withTrustedSender('test_command', guard, () => 'ran');

    it('runs a request from the app itself', () => {
        expect(handler(frame(`${APP_ORIGIN}/index.html`))).toBe('ran');
        expect(handler(frame(`${DEV_SERVER}/index.html`))).toBe('ran');
    });

    it('refuses a spoofed frame URL', () => {
        // The point of the check: a frame that merely *contains* the app origin
        // is a different origin, and every one of these is a URL an attacker
        // controls end to end.
        for (const url of [
            'https://evil.example/app://sourdaw/index.html',
            'https://app.sourdaw.evil.example/',
            'app://sourdaw.evil.example/index.html',
            'app://sourdaw:1/index.html',
            'file:///Users/somebody/index.html',
            'about:blank',
            'not a url',
        ]) {
            expect(() => handler(frame(url))).toThrow(/not the application/u);
        }
    });

    it('refuses a request whose frame has already gone', () => {
        // `senderFrame` is null, or throws, once the frame is destroyed. A
        // sender that cannot be shown to be the app is refused, not trusted.
        expect(() => handler(frame(undefined))).toThrow(/not the application/u);
        expect(() =>
            handler({
                get senderFrame(): { url: string } {
                    throw new Error('frame destroyed');
                },
            })
        ).toThrow(/not the application/u);
    });

    it('re-reads the allow-list on every call, so the dev origin is not baked in', () => {
        // The guard is built before the dev server URL is known. Capturing the
        // origins once would refuse the dev renderer for the whole session.
        const growing: string[] = [];
        const late = trustedFrameGuard(() => growing);

        expect(late(`${DEV_SERVER}/index.html`)).toBe(false);
        growing.push(DEV_SERVER);
        expect(late(`${DEV_SERVER}/index.html`)).toBe(true);
    });

    it('refuses before it runs anything', () => {
        const ran = vi.fn();
        const guarded = withTrustedSender('test_command', guard, ran);

        expect(() => guarded(frame('https://evil.example'))).toThrow();
        expect(ran).not.toHaveBeenCalled();
    });
});

describe('the navigation lockdown', () => {
    it('allows the app origin and the dev server, and nothing else', () => {
        expect(isNavigationAllowed(origins, `${APP_ORIGIN}/projects/new`)).toBe(true);
        expect(isNavigationAllowed(origins, `${DEV_SERVER}/`)).toBe(true);
        expect(isNavigationAllowed(origins, 'https://anthropic.com')).toBe(false);
        expect(isNavigationAllowed(origins, 'app://sourdaw.evil.example/')).toBe(false);
        expect(isNavigationAllowed(origins, 'app://sourdaw:1/')).toBe(false);
        expect(isNavigationAllowed(origins, 'javascript:alert(1)')).toBe(false);
        expect(isNavigationAllowed(origins, 'not a url')).toBe(false);
    });

    it('denies every window-open target and routes only explicit safe destinations', () => {
        // `deny` is unconditional: a second Electron window would inherit this
        // origin, and with it the whole IPC surface.
        expect(decideWindowOpen('https://anthropic.com')).toEqual({ action: 'deny', openExternally: true });
        expect(decideWindowOpen('http://localhost:5173')).toEqual({ action: 'deny', openExternally: true });
        expect(decideWindowOpen(`${APP_ORIGIN}/legal/THIRD-PARTY-NOTICES.md`)).toEqual({
            action: 'deny',
            openExternally: false,
            legalDocument: 'THIRD-PARTY-NOTICES.md',
        });
        expect(decideWindowOpen(`${APP_ORIGIN}/index.html`)).toEqual({ action: 'deny', openExternally: false });
        expect(decideWindowOpen(`${APP_ORIGIN}/legal/THIRD-PARTY-NOTICES.md?other=true`)).toEqual({
            action: 'deny',
            openExternally: false,
        });
        expect(decideWindowOpen('file:///etc/passwd')).toEqual({ action: 'deny', openExternally: false });
        expect(decideWindowOpen('javascript:alert(1)')).toEqual({ action: 'deny', openExternally: false });
        expect(decideWindowOpen('not a url')).toEqual({ action: 'deny', openExternally: false });
    });
});
