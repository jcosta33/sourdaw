import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { isNativeProjectRuntimeAvailable } from '../isNativeProjectRuntimeAvailable';

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: vi.fn(),
}));

describe('isNativeProjectRuntimeAvailable', () => {
    beforeEach(() => {
        vi.mocked(isDesktopRuntime).mockReset();
    });

    it('should return true when the desktop runtime marker is available', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);

        expect(isNativeProjectRuntimeAvailable()).toBe(true);
        expect(isDesktopRuntime).toHaveBeenCalledTimes(1);
    });

    it('should return false when the desktop runtime marker is unavailable', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        expect(isNativeProjectRuntimeAvailable()).toBe(false);
        expect(isDesktopRuntime).toHaveBeenCalledTimes(1);
    });
});
