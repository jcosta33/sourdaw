import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Pad mixer mute', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('Kick mixer M overlays Mute on the pad and clears it', async ({ page }) => {
        const kick = page.getByRole('button', { name: 'Trigger Kick', exact: true });
        const muteOverlay = kick.getByText('Mute', { exact: true });
        const kickMute = page
            .getByRole('slider', { name: 'Kick volume', exact: true })
            .locator('xpath=..')
            .getByRole('button', { name: 'M', exact: true });

        await expect(muteOverlay).toHaveCount(0);

        await kickMute.click();
        await expect(muteOverlay).toBeVisible();

        await kickMute.click();
        await expect(muteOverlay).toHaveCount(0);
    });
});
