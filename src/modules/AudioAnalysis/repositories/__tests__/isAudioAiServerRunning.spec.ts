import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopBridge';

import { isAudioAiServerRunning } from '../isAudioAiServerRunning';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
}));

describe('isAudioAiServerRunning', () => {
    beforeEach(() => {
        vi.mocked(isDesktopRuntime).mockReset();
    });

    it('should resolve true when the desktop runtime is available', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);

        await expect(isAudioAiServerRunning()).resolves.toBe(true);
    });

    it('should resolve false when the desktop runtime is unavailable', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await expect(isAudioAiServerRunning()).resolves.toBe(false);
    });
});
