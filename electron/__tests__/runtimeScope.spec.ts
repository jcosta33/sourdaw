import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveRuntimeScope } from '../runtimeScope.js';

const homes: string[] = [];
const fixture = (): string => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-scope-spec-')));
    homes.push(home);
    const root = join(home, '.sourdaw-native-runtime-scopes-v1', randomUUID());
    mkdirSync(root, { recursive: true });
    return root;
};

afterEach(() => {
    for (const home of homes.splice(0)) {
        rmSync(home, { recursive: true, force: true });
    }
});

describe('trusted runtime home selection', () => {
    it('leaves normal startup untouched when the setting is absent', () => {
        expect(resolveRuntimeScope({})).toBeUndefined();
    });

    it('refuses empty, relative, non-UUID and nonreserved selections', () => {
        for (const root of ['', 'relative', '/tmp/profile', '/tmp/.sourdaw-native-runtime-scopes-v1/INVALID']) {
            expect(() => resolveRuntimeScope({ SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: root })).toThrow();
        }
    });

    it('selects one canonical root without I/O until Chromium is configured', () => {
        const root = fixture();
        const scope = resolveRuntimeScope({ SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: root });
        expect(readdirSync(root)).toEqual([]);
        expect(scope?.paths).toEqual({
            root,
            data: join(root, 'native/data'),
            private: join(root, 'native/data/private'),
            cache: join(root, 'native/cache'),
            ipc: join(root, 'native/ipc'),
            projects: join(root, 'native/projects'),
            scanResponses: join(root, 'native/data/private/scan-responses'),
        });
        expect(scope?.environment).toEqual({ SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: root });
        const setPath = vi.fn();
        scope?.configureChromium({ setPath });
        expect(setPath.mock.calls).toEqual([
            ['userData', join(root, 'chromium/userData')],
            ['sessionData', join(root, 'chromium/sessionData')],
            ['logs', join(root, 'logs')],
        ]);
        expect(Object.isFrozen(scope?.paths)).toBe(true);
    });

    it('refuses a symlinked selected home and a symlinked Chromium child', () => {
        const root = fixture();
        const sibling = join(root, '..', randomUUID());
        symlinkSync(root, sibling, 'dir');
        expect(() => resolveRuntimeScope({ SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: sibling })).toThrow();
        symlinkSync(homes[0] ?? '', join(root, 'chromium'), 'dir');
        const scope = resolveRuntimeScope({ SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT: root });
        expect(() => scope?.configureChromium({ setPath: vi.fn() })).toThrow();
    });
});
