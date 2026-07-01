import { afterEach, describe, expect, it } from 'vitest';

import { isTauri } from '../isTauri';

describe('isTauri repository', () => {
    const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI__');

    function restoreTauriMarker(): void {
        if (originalTauriDescriptor) {
            Object.defineProperty(window, '__TAURI__', originalTauriDescriptor);
            return;
        }

        Reflect.deleteProperty(window, '__TAURI__');
    }

    afterEach(() => {
        restoreTauriMarker();
    });

    it('should return true if __TAURI__ is in window', () => {
        Object.defineProperty(window, '__TAURI__', {
            configurable: true,
            value: {},
        });

        expect(isTauri()).toBe(true);
    });

    it('should return false if __TAURI__ is not in window', () => {
        Reflect.deleteProperty(window, '__TAURI__');

        expect(isTauri()).toBe(false);
    });
});
