import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri } from '#/utils/tauriRuntime';

import { isNativeAiRuntimeAvailable } from '../isNativeAiRuntimeAvailable';

vi.mock('#/utils/tauriRuntime', () => ({
    isTauri: vi.fn(),
}));

describe('isNativeAiRuntimeAvailable repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return true for the desktop native runtime marker', () => {
        vi.mocked(isTauri).mockReturnValue(true);

        expect(isNativeAiRuntimeAvailable()).toBe(true);
    });

    it('should return false outside the desktop native runtime marker', () => {
        vi.mocked(isTauri).mockReturnValue(false);

        expect(isNativeAiRuntimeAvailable()).toBe(false);
    });
});
