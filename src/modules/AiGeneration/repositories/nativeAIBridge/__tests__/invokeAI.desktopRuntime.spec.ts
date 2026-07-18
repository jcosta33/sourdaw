import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { invokeAI } from '../invokeAI';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

/**
 * Regression: the native-AI bridge must recognise the real Tauri v2 desktop
 * runtime. With `withGlobalTauri: false` (see src-tauri/tauri.conf.json) Tauri
 * never injects `window.__TAURI__`; the only always-present marker is
 * `window.__TAURI_INTERNALS__`. A bridge probing `__TAURI__` is latently
 * always-false on desktop, so generate_midi_ai / denoise_audio silently fall
 * back instead of invoking native commands.
 */
describe('invokeAI on the real Tauri desktop runtime', () => {
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
        vi.mocked(invoke).mockReset();
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
        vi.mocked(invoke).mockResolvedValue('native-ok');

        const result = await invokeAI('generate_midi_ai', { request: {} });

        expect(invoke).toHaveBeenCalledWith('generate_midi_ai', { request: {} });
        expect(result).toBe('native-ok');
    });
});
