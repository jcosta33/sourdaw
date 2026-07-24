import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
}));

import { invokeCommand } from '../invokeCommand';
import { isNativeCrdtAvailable } from '../isNativeCrdtAvailable';

/**
 * Regression: the native CRDT persistence bridge must recognise the real Tauri
 * v2 desktop runtime. With `withGlobalTauri: false` (see src-tauri/tauri.conf.json)
 * Tauri never injects `window.__TAURI__`; the only always-present marker is
 * `window.__TAURI_INTERNALS__`. A bridge probing `__TAURI__` is latently
 * always-false on desktop, so invokeCommand silently returns null and
 * isNativeCrdtAvailable reports false even in the packaged desktop app.
 */
describe('nativeCrdtPersistence on the real Tauri desktop runtime', () => {
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

    it('reports the native backend available when only __TAURI_INTERNALS__ is present', () => {
        expect(isNativeCrdtAvailable()).toBe(true);
    });

    it('invokes the native command when only __TAURI_INTERNALS__ is present', async () => {
        mockInvoke.mockResolvedValue('native-ok');

        const result = await invokeCommand('crdt_apply_change', { docId: 'd1' });

        expect(mockInvoke).toHaveBeenCalledWith('crdt_apply_change', { docId: 'd1' });
        expect(result).toBe('native-ok');
    });
});

describe('nativeCrdtPersistence on the browser (non-Tauri) runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Neither runtime marker is present in a plain browser tab.
        Reflect.deleteProperty(window, '__TAURI__');
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('returns null without invoking any native command when not on Tauri', async () => {
        const result = await invokeCommand('crdt_apply_change', { docId: 'd1' });

        // The native bridge must be a no-op outside the desktop webview so the
        // app falls back to the IndexedDB persistence path silently.
        expect(result).toBeNull();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('isNativeCrdtAvailable reports unavailable when no runtime marker is present', async () => {
        vi.resetModules();
        // Re-import to re-evaluate the live (marker-less) window.
        const { isNativeCrdtAvailable } = await import('../isNativeCrdtAvailable');
        expect(isNativeCrdtAvailable()).toBe(false);
    });
});
