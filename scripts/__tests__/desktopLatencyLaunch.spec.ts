import { type Locator } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { waitForVisibleLaunchScreen } from '../desktopLatencyLaunch';

describe('packaged startup visibility', () => {
    it('waits for the New Project control to become visible before admitting startup', async () => {
        const waitFor = vi.fn<Locator['waitFor']>().mockResolvedValue(undefined);
        const locator = vi.fn(() => ({ waitFor }));

        await expect(waitForVisibleLaunchScreen({ locator }, 1000)).resolves.toBe('launch-screen');
        expect(locator).toHaveBeenCalledExactlyOnceWith('#launch-new-project');
        expect(waitFor).toHaveBeenCalledExactlyOnceWith({ state: 'visible', timeout: 1000 });
    });

    it('does not admit startup when the New Project control never becomes visible', async () => {
        const failure = new Error('waiting for locator to be visible');
        const waitFor = vi.fn<Locator['waitFor']>().mockRejectedValue(failure);

        await expect(waitForVisibleLaunchScreen({ locator: () => ({ waitFor }) }, 1000)).rejects.toBe(failure);
    });
});
