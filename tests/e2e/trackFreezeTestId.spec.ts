import { test, expect } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openTrackMenu(page: import('@playwright/test').Page, trackName: RegExp | string): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const row = trackList.getByRole('row').filter({ hasText: trackName }).first();
    await row.waitFor({ state: 'attached' });
    await row.click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
}

test.describe('Track freeze / unfreeze', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('freeze shows the FROZEN badge then unfreeze removes it', async ({ page }) => {
        // Kick has MIDI content + accepts freeze.
        await openTrackMenu(page, /Kick/i);

        const freezeItem = page.getByTestId('track-freeze-item');
        await expect(freezeItem).toHaveText(/Freeze/);
        await freezeItem.click();

        const kickRow = page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ hasText: /Kick/i })
            .first();

        // Freeze may briefly show FREEZING then settle to FROZEN. Wait for the
        // frozen badge within the Kick row.
        await expect(kickRow.getByTestId('track-frozen-badge')).toBeAttached({ timeout: 60000 });

        // The menu label must now read Unfreeze, proving the freeze committed.
        await openTrackMenu(page, /Kick/i);
        await expect(page.getByTestId('track-freeze-item')).toHaveText(/Unfreeze/);
        await page.getByTestId('track-freeze-item').click();

        await expect(kickRow.getByTestId('track-frozen-badge')).toHaveCount(0, { timeout: 30000 });
    });

    test('frozen track exposes the Flatten Track menu item', async ({ page }) => {
        // Before freeze, the menu has no Flatten item.
        await openTrackMenu(page, /Kick/i);
        await expect(page.getByTestId('track-flatten-item')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Freeze the track.
        await openTrackMenu(page, /Kick/i);
        await page.getByTestId('track-freeze-item').click();
        const kickRow = page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ hasText: /Kick/i })
            .first();
        await expect(kickRow.getByTestId('track-frozen-badge')).toBeAttached({ timeout: 60000 });

        // After freeze, the Flatten Track item appears — proving the frozen branch.
        await openTrackMenu(page, /Kick/i);
        const flattenItem = page.getByTestId('track-flatten-item');
        await expect(flattenItem).toBeVisible();
        await expect(flattenItem).toHaveText(/Flatten Track/);
    });
});
