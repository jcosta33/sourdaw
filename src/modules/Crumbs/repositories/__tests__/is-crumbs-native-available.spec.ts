import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri } from '#/utils/tauriBridge';

import { isCrumbsNativeAvailable } from '../is-crumbs-native-available';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn<() => boolean>(),
}));

describe('isCrumbsNativeAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return true when the Tauri bridge is available', () => {
        vi.mocked(isTauri).mockReturnValue(true);

        expect(isCrumbsNativeAvailable()).toBe(true);
    });

    it('should return false when the Tauri bridge is unavailable', () => {
        vi.mocked(isTauri).mockReturnValue(false);

        expect(isCrumbsNativeAvailable()).toBe(false);
    });
});
