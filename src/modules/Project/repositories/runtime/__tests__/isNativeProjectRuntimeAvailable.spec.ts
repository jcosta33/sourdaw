import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isTauri } from '#/utils/tauriRuntime';

import { isNativeProjectRuntimeAvailable } from '../isNativeProjectRuntimeAvailable';

vi.mock('#/utils/tauriRuntime', () => ({
    isTauri: vi.fn(),
}));

describe('isNativeProjectRuntimeAvailable', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
    });

    it('should return true when the Tauri runtime marker is available', () => {
        vi.mocked(isTauri).mockReturnValue(true);

        expect(isNativeProjectRuntimeAvailable()).toBe(true);
        expect(isTauri).toHaveBeenCalledTimes(1);
    });

    it('should return false when the Tauri runtime marker is unavailable', () => {
        vi.mocked(isTauri).mockReturnValue(false);

        expect(isNativeProjectRuntimeAvailable()).toBe(false);
        expect(isTauri).toHaveBeenCalledTimes(1);
    });
});
