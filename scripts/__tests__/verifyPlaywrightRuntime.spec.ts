// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyPlaywrightRuntime } from '../verifyPlaywrightRuntime';

describe('preinstalled Playwright runtime admission', () => {
    const close = vi.fn(async () => {});
    const launch = vi.fn(async () => ({ version: (): string => '158.0.8127.18', close }));

    beforeEach(() => {
        vi.clearAllMocks();
        launch.mockResolvedValue({
            version: () => '158.0.8127.18',
            close,
        });
    });

    it('launches the browser and checks its version against the resolved package', async () => {
        await expect(verifyPlaywrightRuntime('1.65.0', launch)).resolves.toBe(
            'Preinstalled Playwright 1.65.0 launched Chromium 158.0.8127.18'
        );
        expect(launch).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it('refuses an image version that differs from the installed package before launch', async () => {
        await expect(verifyPlaywrightRuntime('1.62.0', launch)).rejects.toThrow(
            'does not match resolved package 1.65.0'
        );
        expect(launch).not.toHaveBeenCalled();
    });

    it('fails when the preinstalled browser cannot launch', async () => {
        launch.mockRejectedValue(new Error('missing preinstalled executable'));
        await expect(verifyPlaywrightRuntime('1.65.0', launch)).rejects.toThrow('missing preinstalled executable');
    });

    it('refuses a different launched browser version and still closes it', async () => {
        launch.mockResolvedValue({
            version: () => '152.0.0.0',
            close,
        });
        await expect(verifyPlaywrightRuntime('1.65.0', launch)).rejects.toThrow(
            'does not match resolved Playwright browser'
        );
        expect(close).toHaveBeenCalledOnce();
    });
});
