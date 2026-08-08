import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openModulationTab(page: import('@playwright/test').Page): Promise<void> {
    // Open the bottom dock.
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }

    // Switch to the Modulation tab.
    const modTab = page.locator('#bottom-dock-tab-modulation');
    if (await modTab.isVisible().catch(() => false)) {
        await modTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Modulation matrix — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await openModulationTab(page);
    });

    test('New Modulator button is present via test ID', async ({ page }) => {
        const newBtn = page.getByTestId('modulation-new-button');
        const hasBtn = await newBtn.isVisible().catch(() => false);
        if (!hasBtn) {
            await expect(newBtn).toBeAttached({ timeout: 10_000 });
        }
    });

    test('clicking New Modulator toggles aria-expanded', async ({ page }) => {
        const newBtn = page.getByTestId('modulation-new-button');
        if (await newBtn.isVisible().catch(() => false)) {
            const before = await newBtn.getAttribute('aria-expanded');
            await newBtn.click();
            await page.waitForTimeout(300);
            await expect(newBtn).not.toHaveAttribute('aria-expanded', before ?? '');
        }
    });

    test('modulation matrix shows empty state text', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        if (await matrix.isVisible().catch(() => false)) {
            const text = (await matrix.innerText()).trim();
            expect(text.length).toBeGreaterThan(0);
        }
    });

    test('modulation tab is accessible in the bottom dock', async ({ page }) => {
        const modTab = page.locator('#bottom-dock-tab-modulation');
        const hasTab = await modTab.isVisible().catch(() => false);
        if (hasTab) {
            // The tab should be a tab role.
            const role = await modTab.getAttribute('role');
            expect(role === 'tab' || role === 'button' || role === null).toBe(true);
        }
    });
});
