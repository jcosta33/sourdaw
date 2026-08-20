import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime, isSourdawRuntime } from '../desktopRuntime';

describe('desktopRuntime', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(window, 'sourdaw');
    });

    it('should return false when window is unavailable', () => {
        vi.stubGlobal('window', undefined);

        expect(isDesktopRuntime()).toBe(false);
        expect(isSourdawRuntime()).toBe(false);
    });

    it('should return false when the preload bridge is absent', () => {
        expect(isDesktopRuntime()).toBe(false);
        expect(isSourdawRuntime()).toBe(false);
    });

    it('should return true when the preload published window.sourdaw', () => {
        Object.defineProperty(window, 'sourdaw', {
            configurable: true,
            value: {},
        });

        expect(isDesktopRuntime()).toBe(true);
        expect(isSourdawRuntime()).toBe(true);
    });
});
