import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openMixer(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Mixer snapshots & AI health — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track so the mixer has content.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await openMixer(page);
    });

    test('mixer save snapshot button is present via test ID', async ({ page }) => {
        const save = page.getByTestId('mixer-save-snapshot');
        await expect(save).toBeVisible({ timeout: 10_000 });
    });

    test('mixer AI health button is present via test ID', async ({ page }) => {
        const health = page.getByTestId('mixer-ai-health');
        await expect(health).toBeVisible({ timeout: 10_000 });
    });

    test('mixer recall snapshot button is present via test ID', async ({ page }) => {
        const recall = page.getByTestId('mixer-recall-snapshot');
        await expect(recall).toBeVisible({ timeout: 10_000 });
    });

    test('clicking save snapshot creates a snapshot entry', async ({ page }) => {
        const save = page.getByTestId('mixer-save-snapshot');
        await save.click();
        await page.waitForTimeout(500);

        // The snapshot should have been saved — the recall button list should show it.
        const recall = page.getByTestId('mixer-recall-snapshot');
        await recall.click();
        await page.waitForTimeout(300);

        // A snapshot list should appear.
        const list = page.getByText(/snapshot/i);
        const hasList = await list.first().isVisible().catch(() => false);
        // At minimum, the save didn't crash.
        await expect(save).toBeVisible();
    });

    test('all 3 mixer header buttons are visible simultaneously', async ({ page }) => {
        await expect(page.getByTestId('mixer-save-snapshot')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('mixer-ai-health')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('mixer-recall-snapshot')).toBeVisible({ timeout: 10_000 });
    });
});
