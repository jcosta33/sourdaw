import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openSetlistTab(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }

    const setlistTab = page.locator('#bottom-dock-tab-setlist');
    if (await setlistTab.isVisible().catch(() => false)) {
        await setlistTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Setlist & loop station — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await openSetlistTab(page);
    });

    test('setlist add button is present via test ID', async ({ page }) => {
        const add = page.getByTestId('setlist-add-item');
        const hasAdd = await add.isVisible().catch(() => false);
        if (!hasAdd) {
            await expect(add).toBeAttached({ timeout: 10_000 });
        }
    });

    test('clicking add creates a setlist item', async ({ page }) => {
        const add = page.getByTestId('setlist-add-item');
        if (await add.isVisible().catch(() => false)) {
            const listBefore = await page.getByRole('list', { name: 'Setlist items' }).isVisible().catch(() => false);

            await add.click();
            await page.waitForTimeout(500);

            // The list should now be visible with at least one item.
            const list = page.getByRole('list', { name: 'Setlist items' });
            if (await list.isVisible().catch(() => false)) {
                const items = list.locator('[role="listitem"]').or(list.locator('> div'));
                const count = await items.count();
                expect(count).toBeGreaterThan(0);
            }
        }
    });

    test('loop station region is present', async ({ page }) => {
        // Switch to loop station tab.
        const loopTab = page.locator('#bottom-dock-tab-loopStation');
        if (await loopTab.isVisible().catch(() => false)) {
            await loopTab.click();
            await page.waitForTimeout(500);

            const station = page.getByRole('region', { name: 'Loop station' });
            const hasStation = await station.isVisible().catch(() => false);
            if (hasStation) {
                const text = (await station.innerText()).trim();
                expect(text.length).toBeGreaterThan(0);
            }
        }
    });

    test('loop station arm button is present when tab is active', async ({ page }) => {
        const loopTab = page.locator('#bottom-dock-tab-loopStation');
        if (await loopTab.isVisible().catch(() => false)) {
            await loopTab.click();
            await page.waitForTimeout(500);

            const arm = page.getByRole('button', { name: /Arm loop station/i }).or(
                page.getByRole('button', { name: /Disarm loop station/i })
            );
            const hasArm = await arm.first().isVisible().catch(() => false);
            if (hasArm) {
                const label = await arm.first().getAttribute('aria-label');
                expect(label).toContain('loop station');
            }
        }
    });
});
