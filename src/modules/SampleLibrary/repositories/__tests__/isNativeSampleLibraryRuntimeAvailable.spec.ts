import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isTauri } from '#/utils/tauriRuntime';

import { isNativeSampleLibraryRuntimeAvailable } from '../isNativeSampleLibraryRuntimeAvailable';

vi.mock('#/utils/tauriRuntime', () => ({
    isTauri: vi.fn(),
}));

describe('isNativeSampleLibraryRuntimeAvailable', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
    });

    it('should report native availability from the browser-safe Tauri marker', () => {
        vi.mocked(isTauri).mockReturnValue(true);

        expect(isNativeSampleLibraryRuntimeAvailable()).toBe(true);
        expect(isTauri).toHaveBeenCalledTimes(1);
    });

    it('should report browser runtime unavailability from the browser-safe Tauri marker', () => {
        vi.mocked(isTauri).mockReturnValue(false);

        expect(isNativeSampleLibraryRuntimeAvailable()).toBe(false);
        expect(isTauri).toHaveBeenCalledTimes(1);
    });
});
