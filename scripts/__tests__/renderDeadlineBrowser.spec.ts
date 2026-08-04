import { describe, expect, it, vi } from 'vitest';

import { getRenderDeadlineBrowserLaunchOptions, launchRenderDeadlineBrowser } from '../renderDeadlineBrowser';

describe('getRenderDeadlineBrowserLaunchOptions', () => {
    it.each([
        { headed: false, expectedHeadless: true },
        { headed: true, expectedHeadless: false },
    ])('launches installed stable Chrome when headed is $headed', ({ headed, expectedHeadless }) => {
        expect(getRenderDeadlineBrowserLaunchOptions({ headed })).toEqual({
            channel: 'chrome',
            headless: expectedHeadless,
            args: ['--autoplay-policy=no-user-gesture-required'],
        });
    });
});

describe('launchRenderDeadlineBrowser', () => {
    it('returns the browser after a successful stable Chrome launch', async () => {
        const browser = { close: vi.fn() };
        const launchBrowser = vi.fn(() => Promise.resolve(browser));

        const result = await launchRenderDeadlineBrowser({ headed: true, launchBrowser });

        expect(launchBrowser).toHaveBeenCalledWith({
            channel: 'chrome',
            headless: false,
            args: ['--autoplay-policy=no-user-gesture-required'],
        });
        expect(result).toEqual({ status: 'launched', browser });
    });

    it('classifies an unavailable stable Chrome as not measured', async () => {
        const error = new Error("browserType.launch: Chromium distribution 'chrome' is not found at /missing");
        const launchBrowser = vi.fn(() => Promise.reject(error));

        const result = await launchRenderDeadlineBrowser({ headed: false, launchBrowser });

        expect(launchBrowser).toHaveBeenCalledWith({
            channel: 'chrome',
            headless: true,
            args: ['--autoplay-policy=no-user-gesture-required'],
        });
        expect(result).toEqual({ status: 'not-measured', error });
    });

    it('does not classify an unexpected launcher defect as an unavailable browser', async () => {
        const error = new Error('invalid launch option');
        const launchBrowser = vi.fn(() => Promise.reject(error));

        await expect(launchRenderDeadlineBrowser({ headed: false, launchBrowser })).rejects.toBe(error);
    });
});
