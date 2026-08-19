/**
 * `resolveRequestPath` is the one function in the shell that parses
 * attacker-influenceable input: everything in it runs on a URL the renderer
 * chose. Its contract is total — every pathname resolves to a file path, to the
 * SPA fallback, or to `undefined` — and it is called outside the protocol
 * handler's `try`, so a throw does not become a 404, it becomes a rejected
 * request.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { APP_ENTRY_URL, resolveRequestPath } from '../protocol.js';

// The module imports Electron's `app`, `net` and `protocol` at load time, none
// of which exist outside an Electron process. `vi.mock` is hoisted above the
// import above, so the real module is never reached.
vi.mock('electron', () => ({
    app: { isPackaged: false, getAppPath: () => '/app' },
    net: { fetch: vi.fn() },
    protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
}));

let distDir = '';
let samplesDir = '';
const roots = (): { distDir: string; samplesDir: string } => ({ distDir, samplesDir });

beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'sourdaw-protocol-'));
    samplesDir = mkdtempSync(join(tmpdir(), 'sourdaw-samples-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html>');
    writeFileSync(join(distDir, 'real.js'), '// asset');
});

describe('APP_ENTRY_URL', () => {
    it('should load a pathname the client router matches', () => {
        // The router's only route is `/`; an `/index.html` entry renders its
        // not-found view inside the packaged shell while the web app works.
        expect(new URL(APP_ENTRY_URL).pathname).toBe('/');
    });
});

describe('resolveRequestPath', () => {
    it('should resolve an existing asset to its file', () => {
        expect(resolveRequestPath(roots(), '/real.js')).toBe(join(distDir, 'real.js'));
    });

    it('should serve the SPA entry for the root and for a client route', () => {
        expect(resolveRequestPath(roots(), '/')).toBe(join(distDir, 'index.html'));
        expect(resolveRequestPath(roots(), '/projects/new')).toBe(join(distDir, 'index.html'));
    });

    it('should refuse a path that escapes the root', () => {
        expect(resolveRequestPath(roots(), '/../secrets.env')).toBeUndefined();
        expect(resolveRequestPath(roots(), '/%2e%2e/secrets.env')).toBeUndefined();
    });

    it('should answer a NUL byte in the path instead of throwing', () => {
        // `app://sourdaw/a%00.js` decodes to a path containing `\0`, for which
        // `statSync` throws `ERR_INVALID_ARG_VALUE` — `throwIfNoEntry: false`
        // suppresses only `ENOENT`/`ENOTDIR`. Unhandled, that rejects a request
        // that has to answer 404.
        expect(() => resolveRequestPath(roots(), '/a%00.js')).not.toThrow();
        expect(resolveRequestPath(roots(), '/a%00.js')).toBe(join(distDir, 'a\0.js'));
        expect(resolveRequestPath(roots(), '/route%00x')).toBe(join(distDir, 'index.html'));
    });

    it('should answer an over-long path instead of throwing', () => {
        // `ENAMETOOLONG`, same class as `EACCES` and `ELOOP`: a stat error the
        // `throwIfNoEntry` flag does not cover. Not a file, so: fallback.
        const tooLong = `/${'n'.repeat(5000)}`;
        expect(() => resolveRequestPath(roots(), tooLong)).not.toThrow();
        expect(resolveRequestPath(roots(), tooLong)).toBe(join(distDir, 'index.html'));
    });
});
