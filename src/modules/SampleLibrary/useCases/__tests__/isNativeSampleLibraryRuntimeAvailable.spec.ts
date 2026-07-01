import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isNativeSampleLibraryRuntimeAvailable as readNativeSampleLibraryRuntimeAvailable } from '../../repositories/isNativeSampleLibraryRuntimeAvailable';
import { isNativeSampleLibraryRuntimeAvailable } from '../isNativeSampleLibraryRuntimeAvailable';

vi.mock('../../repositories/isNativeSampleLibraryRuntimeAvailable', () => ({
    isNativeSampleLibraryRuntimeAvailable: vi.fn(),
}));

describe('isNativeSampleLibraryRuntimeAvailable', () => {
    beforeEach(() => {
        vi.mocked(readNativeSampleLibraryRuntimeAvailable).mockReset();
    });

    it('should expose native runtime availability from the SampleLibrary repository', () => {
        vi.mocked(readNativeSampleLibraryRuntimeAvailable).mockReturnValue(true);

        expect(isNativeSampleLibraryRuntimeAvailable()).toBe(true);
        expect(readNativeSampleLibraryRuntimeAvailable).toHaveBeenCalledTimes(1);
    });

    it('should expose browser runtime unavailability from the SampleLibrary repository', () => {
        vi.mocked(readNativeSampleLibraryRuntimeAvailable).mockReturnValue(false);

        expect(isNativeSampleLibraryRuntimeAvailable()).toBe(false);
        expect(readNativeSampleLibraryRuntimeAvailable).toHaveBeenCalledTimes(1);
    });
});
