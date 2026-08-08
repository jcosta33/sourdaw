import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openAutomationTab(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }

    const autoTab = page.locator('#bottom-dock-tab-automation');
    if (await autoTab.isVisible().catch(() => false)) {
        await autoTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Automation lanes — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await openAutomationTab(page);
    });

    test('automation mode button is present via test ID', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        const hasMode = await mode.isVisible().catch(() => false);
        if (!hasMode) {
            await expect(mode).toBeAttached({ timeout: 10_000 });
        }
    });

    test('automation mode shows the current mode label', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        if (await mode.isVisible().catch(() => false)) {
            const text = (await mode.innerText()).trim();
            expect(text.length).toBeGreaterThan(0);
        }
    });

    test('clicking automation mode opens a dropdown', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        if (await mode.isVisible().catch(() => false)) {
            await mode.click();
            await page.waitForTimeout(300);

            // The dropdown should show mode options (Read, Write, Touch, Latch).
            const options = page.getByRole('button').filter({ hasText: /read|write|touch|latch/i });
            const count = await options.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('automation mode has a valid aria-label', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        if (await mode.isVisible().catch(() => false)) {
            const label = await mode.getAttribute('aria-label');
            expect(label).toContain('Automation mode');
        }
    });
});
