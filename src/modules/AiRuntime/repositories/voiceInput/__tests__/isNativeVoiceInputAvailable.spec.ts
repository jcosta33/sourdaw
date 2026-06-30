import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri } from '#/utils/tauriBridge';

import { isNativeVoiceInputAvailable } from '../isNativeVoiceInputAvailable';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
}));

describe('isNativeVoiceInputAvailable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return true for the desktop native runtime', () => {
        vi.mocked(isTauri).mockReturnValue(true);

        expect(isNativeVoiceInputAvailable()).toBe(true);
    });

    it('should return false outside the desktop native runtime', () => {
        vi.mocked(isTauri).mockReturnValue(false);

        expect(isNativeVoiceInputAvailable()).toBe(false);
    });
});
