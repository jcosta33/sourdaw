/**
 * The webview security boundary of the Electron shell (AC-003).
 *
 * The port of `src/utils/__tests__/agentWebviewSecurity.spec.ts`. That spec
 * pins the Tauri capability; this one pins the four things the Electron shell
 * decides for itself and that are each silent when wrong:
 *
 * - the Content-Security-Policy every `app://` response carries,
 * - the permission allow-list,
 * - the sender-origin check every IPC handler runs, exercised with a spoofed
 *   frame URL rather than only with the honest one,
 * - the navigation lockdown: `will-navigate` denies off-origin, and
 *   `windowOpenHandler` denies every target.
 *
 * The command sets are pinned in `commands.spec.ts`, where they are re-derived
 * from Rust.
 */
import { describe, expect, it, vi } from 'vitest';

import { APP_ORIGIN, ISOLATION_HEADERS, PRODUCTION_CSP } from '../protocol.js';
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

describe('the production Content-Security-Policy', () => {
    const directives = parseCsp(PRODUCTION_CSP);

    it('admits no eval and no inline script', () => {
        expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
        expect([...directives.values()].flat()).not.toContain("'unsafe-eval'");
        expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
    });

    it('admits only bundled workers and the enumerated provider and model hosts', () => {
        expect(directives.get('worker-src')).toEqual(["'self'"]);
        // The enumerated production connection surface, and nothing wider,
        // mirroring the Tauri policy (#2171): loopback HTTP for user-run
        // OpenAI-compatible LLM servers, Hugging Face plus its CDN redirect
        // hosts for Kokoro/WebLLM model artifacts, the MLC wasm runtime on
        // raw.githubusercontent.com, and DDSP checkpoints on
        // storage.googleapis.com. A bare `https:` is an open exfiltration
        // channel and must never return.
        expect(directives.get('connect-src')).toEqual([
            "'self'",
            'http://localhost:*',
            'http://127.0.0.1:*',
            'https://huggingface.co',
            'https://*.huggingface.co',
            'https://*.hf.co',
            'https://raw.githubusercontent.com',
            'https://storage.googleapis.com',
        ]);
        expect(directives.get('connect-src')).not.toContain('https:');
        expect([...directives.values()].flat()).not.toContain('https:');
        expect([...directives.values()].flat()).not.toContain('http:');
        expect([...directives.values()].flat()).not.toContain('ws:');
    });

    it('closes the directives an injected document would reach for', () => {
        expect(directives.get('object-src')).toEqual(["'none'"]);
        expect(directives.get('base-uri')).toEqual(["'self'"]);
        expect(directives.get('frame-src')).toEqual(["'none'"]);
        expect(directives.get('form-action')).toEqual(["'self'"]);
    });

    it('ships that policy on every response, alongside the isolation headers', () => {
        // Asserted against the headers the handler actually sends. A policy
        // string that is correct in a constant nothing attaches is a policy
        // that is not applied.
        expect(ISOLATION_HEADERS['Content-Security-Policy']).toBe(PRODUCTION_CSP);
        expect(ISOLATION_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
        expect(ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
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

    it('denies every window-open target, opening only web URLs externally', () => {
        // `deny` is unconditional: a second Electron window would inherit this
        // origin, and with it the whole IPC surface.
        expect(decideWindowOpen('https://anthropic.com')).toEqual({ action: 'deny', openExternally: true });
        expect(decideWindowOpen('http://localhost:5173')).toEqual({ action: 'deny', openExternally: true });
        expect(decideWindowOpen(`${APP_ORIGIN}/index.html`)).toEqual({ action: 'deny', openExternally: false });
        expect(decideWindowOpen('file:///etc/passwd')).toEqual({ action: 'deny', openExternally: false });
        expect(decideWindowOpen('javascript:alert(1)')).toEqual({ action: 'deny', openExternally: false });
        expect(decideWindowOpen('not a url')).toEqual({ action: 'deny', openExternally: false });
    });
});
