import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// Toaster Transport chips: the Play/Stop chip starts the pattern sequencer
// (aria-pressed flips on isPlaying) and the To timeline chip exports the
// pattern. No E2E covers these (a prior attempt failed on Play-name collision
// with the transport bar; the fix is scoping to the Transport SectionCard).
test.describe('Toaster Transport — Play/Stop chip toggles', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('Play chip starts the sequencer and relabels to Stop', async ({ page }) => {
        // Scope to the Transport SectionCard to avoid the transport-bar Play.
        const transportCard = page.locator('section, [class*="section"]')
            .filter({ has: page.getByText('Transport', { exact: true }) })
            .first();
        const playChip = transportCard.getByRole('button', { name: 'Play', exact: true });
        await expect(playChip).toBeVisible({ timeout: 10_000 });

        // Default: not playing. aria-pressed absent (DawPluginChip omits when inactive).
        await expect(playChip).not.toHaveAttribute('aria-pressed', 'true');

        // Click Play — the chip relabels to Stop and is pressed.
        await playChip.click();
        await page.waitForTimeout(500);
        const stopChip = transportCard.getByRole('button', { name: 'Stop', exact: true });
        await expect(stopChip).toBeVisible({ timeout: 5000 });
        await expect(stopChip).toHaveAttribute('aria-pressed', 'true');

        // Click Stop — back to Play.
        await stopChip.click();
        await page.waitForTimeout(500);
        await expect(transportCard.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 5000 });
    });
});
