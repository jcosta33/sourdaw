import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopBridge';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { isNativeVoiceInputAvailable } from '../isNativeVoiceInputAvailable';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
}));

describe('isNativeVoiceInputAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true only for desktop with a verified local model', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });

        expect(isNativeVoiceInputAvailable()).toBe(true);
    });

    it('returns false for desktop without a verified local model', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });

        expect(isNativeVoiceInputAvailable()).toBe(false);
    });

    it('should return false outside the desktop native runtime', () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });

        expect(isNativeVoiceInputAvailable()).toBe(false);
    });
});
