import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTauri } from '../tauriRuntime';

describe('tauriRuntime', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('should return false when window is unavailable', () => {
        vi.stubGlobal('window', undefined);

        expect(isTauri()).toBe(false);
    });

    it('should return false when __TAURI_INTERNALS__ is absent', () => {
        expect(isTauri()).toBe(false);
    });

    it('should return true when __TAURI_INTERNALS__ is on window', () => {
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
            configurable: true,
            value: {},
        });

        expect(isTauri()).toBe(true);
    });
});
