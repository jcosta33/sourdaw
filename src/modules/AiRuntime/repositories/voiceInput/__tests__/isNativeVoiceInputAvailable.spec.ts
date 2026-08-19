import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopBridge';

import { isNativeVoiceInputAvailable } from '../isNativeVoiceInputAvailable';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
}));

describe('isNativeVoiceInputAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return true for the desktop native runtime', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);

        expect(isNativeVoiceInputAvailable()).toBe(true);
    });

    it('should return false outside the desktop native runtime', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        expect(isNativeVoiceInputAvailable()).toBe(false);
    });
});
