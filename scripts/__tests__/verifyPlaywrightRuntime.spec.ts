// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyPlaywrightRuntime } from '../verifyPlaywrightRuntime';

describe('preinstalled Playwright runtime admission', () => {
    const close = vi.fn(async () => {});
    const launch = vi.fn(async () => ({ version: (): string => '156.0.8078.4', close }));

    beforeEach(() => {
        vi.clearAllMocks();
        launch.mockResolvedValue({
            version: () => '156.0.8078.4',
            close,
        });
    });

    it('launches the browser and checks its version against the resolved package', async () => {
        await expect(verifyPlaywrightRuntime('1.64.1', launch)).resolves.toBe(
            'Preinstalled Playwright 1.64.1 launched Chromium 156.0.8078.4'
        );
        expect(launch).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it('refuses an image version that differs from the installed package before launch', async () => {
        await expect(verifyPlaywrightRuntime('1.62.0', launch)).rejects.toThrow(
            'does not match resolved package 1.64.1'
        );
        expect(launch).not.toHaveBeenCalled();
    });

    it('fails when the preinstalled browser cannot launch', async () => {
        launch.mockRejectedValue(new Error('missing preinstalled executable'));
        await expect(verifyPlaywrightRuntime('1.64.1', launch)).rejects.toThrow('missing preinstalled executable');
    });

    it('refuses a different launched browser version and still closes it', async () => {
        launch.mockResolvedValue({
            version: () => '152.0.0.0',
            close,
        });
        await expect(verifyPlaywrightRuntime('1.64.1', launch)).rejects.toThrow(
            'does not match resolved Playwright browser'
        );
        expect(close).toHaveBeenCalledOnce();
    });
});
