import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopBridge';

import { isCrumbsNativeAvailable } from '../is-crumbs-native-available';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn<() => boolean>(),
}));

describe('isCrumbsNativeAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return true when the desktop bridge is available', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);

        expect(isCrumbsNativeAvailable()).toBe(true);
    });

    it('should return false when the desktop bridge is unavailable', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        expect(isCrumbsNativeAvailable()).toBe(false);
    });
});
