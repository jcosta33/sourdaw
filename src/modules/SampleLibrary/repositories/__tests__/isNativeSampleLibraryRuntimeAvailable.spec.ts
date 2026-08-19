import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { isNativeSampleLibraryRuntimeAvailable } from '../isNativeSampleLibraryRuntimeAvailable';

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: vi.fn(),
}));

describe('isNativeSampleLibraryRuntimeAvailable', () => {
    beforeEach(() => {
        vi.mocked(isDesktopRuntime).mockReset();
    });

    it('should report native availability from the browser-safe desktop marker', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);

        expect(isNativeSampleLibraryRuntimeAvailable()).toBe(true);
        expect(isDesktopRuntime).toHaveBeenCalledTimes(1);
    });

    it('should report browser runtime unavailability from the browser-safe desktop marker', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        expect(isNativeSampleLibraryRuntimeAvailable()).toBe(false);
        expect(isDesktopRuntime).toHaveBeenCalledTimes(1);
    });
});
