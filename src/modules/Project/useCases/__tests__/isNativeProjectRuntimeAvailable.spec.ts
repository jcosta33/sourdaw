import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isNativeProjectRuntimeAvailable as readNativeProjectRuntimeAvailable } from '../../repositories/runtime/isNativeProjectRuntimeAvailable';
import { isNativeProjectRuntimeAvailable } from '../isNativeProjectRuntimeAvailable';

vi.mock('../../repositories/runtime/isNativeProjectRuntimeAvailable', () => ({
    isNativeProjectRuntimeAvailable: vi.fn(),
}));

describe('isNativeProjectRuntimeAvailable', () => {
    beforeEach(() => {
        vi.mocked(readNativeProjectRuntimeAvailable).mockReset();
    });

    it('should expose native runtime availability from the Project repository', () => {
        vi.mocked(readNativeProjectRuntimeAvailable).mockReturnValue(true);

        expect(isNativeProjectRuntimeAvailable()).toBe(true);
        expect(readNativeProjectRuntimeAvailable).toHaveBeenCalledTimes(1);
    });

    it('should expose browser runtime unavailability from the Project repository', () => {
        vi.mocked(readNativeProjectRuntimeAvailable).mockReturnValue(false);

        expect(isNativeProjectRuntimeAvailable()).toBe(false);
        expect(readNativeProjectRuntimeAvailable).toHaveBeenCalledTimes(1);
    });
});
