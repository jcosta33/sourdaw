import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
}));

import { invokeLink } from '../invokeLink';

/**
 * Regression: the Ableton Link bridge must recognise the real Tauri v2 desktop
 * runtime. With `withGlobalTauri: false` (see src-tauri/tauri.conf.json) Tauri
 * never injects `window.__TAURI__`; the only always-present marker is
 * `window.__TAURI_INTERNALS__`. A bridge probing `__TAURI__` is latently
 * always-false on desktop, so enable/disable/status silently throw the web
 * fallback error instead of invoking native Link commands.
 */
describe('invokeLink on the real Tauri desktop runtime', () => {
    const originalInternals = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');
    const originalGlobal = Object.getOwnPropertyDescriptor(window, '__TAURI__');

    function restoreMarkers(): void {
        if (originalInternals) {
            Object.defineProperty(window, '__TAURI_INTERNALS__', originalInternals);
        } else {
            Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
        }

        if (originalGlobal) {
            Object.defineProperty(window, '__TAURI__', originalGlobal);
        } else {
            Reflect.deleteProperty(window, '__TAURI__');
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // Simulate the desktop webview: the v2 runtime marker is present,
        // the legacy global is NOT (withGlobalTauri is false).
        Reflect.deleteProperty(window, '__TAURI__');
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
            configurable: true,
            value: {},
        });
    });

    afterEach(() => {
        restoreMarkers();
    });

    it('invokes the native command when only __TAURI_INTERNALS__ is present', async () => {
        mockInvoke.mockResolvedValue('native-ok');

        const result = await invokeLink('enable_link', { quantum: 4 });

        expect(mockInvoke).toHaveBeenCalledWith('enable_link', { quantum: 4 });
        expect(result).toBe('native-ok');
    });
});
