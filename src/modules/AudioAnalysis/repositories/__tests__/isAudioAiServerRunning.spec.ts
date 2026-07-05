import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri } from '#/utils/tauriBridge';

import { isAudioAiServerRunning } from '../isAudioAiServerRunning';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
}));

describe('isAudioAiServerRunning', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
    });

    it('should resolve true when Tauri is available', async () => {
        vi.mocked(isTauri).mockReturnValue(true);

        await expect(isAudioAiServerRunning()).resolves.toBe(true);
    });

    it('should resolve false when Tauri is unavailable', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        await expect(isAudioAiServerRunning()).resolves.toBe(false);
    });
});
