import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri } from '#/utils/tauriBridge';

import { isAudioGenerationAvailable } from '../isAudioGenerationAvailable';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
}));

describe('isAudioGenerationAvailable', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
    });

    it('should return true when Tauri is available', () => {
        vi.mocked(isTauri).mockReturnValue(true);

        expect(isAudioGenerationAvailable()).toBe(true);
    });

    it('should return false when Tauri is unavailable', () => {
        vi.mocked(isTauri).mockReturnValue(false);

        expect(isAudioGenerationAvailable()).toBe(false);
    });
});
