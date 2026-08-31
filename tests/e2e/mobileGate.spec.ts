import { test, expect, type Page } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

async function expectWorkspaceReady(page: Page): Promise<void> {
    await expect(page.getByTestId('transport-play')).toBeVisible({ timeout: 20_000 });
}

// The mobile gate owns shell mounting and classifies the device once, from
// platform identity — coarse pointer plus screen size — never from window
// width (#2000 retired the 768px innerWidth breakpoint: phones crossed it in
// landscape and booted the shell). Desktop Chromium has a fine pointer, so
// even a narrow window boots the workspace and the notice never appears.
// Regression-prone area with mostly component-spec coverage.
test.describe('Mobile gate — device class, not window width', () => {
    test('narrow fine-pointer window boots the workspace and resizes never remount it', async ({ page }) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width: 700, height: 800 });
        await setupWorkspace(page);

        // A fine-pointer device is never gated, whatever its window size: the
        // real app shell mounts, not the notice.
        await expectWorkspaceReady(page);
        await expect(page.getByText('Desktop DAW')).toHaveCount(0);

        // Crossing the retired breakpoint in either direction must not remount
        // the shell — a remount re-runs its boot effects, and `loadProject`
        // ends in `clearUndoHistory()`, discarding the user's session.
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(page.getByTestId('transport-play')).toBeVisible();

        await page.setViewportSize({ width: 700, height: 800 });
        await page.waitForTimeout(500);
        await expect(page.getByTestId('transport-play')).toBeVisible();
        await expect(page.getByTestId('transport-play')).toHaveCount(1);
    });
});
