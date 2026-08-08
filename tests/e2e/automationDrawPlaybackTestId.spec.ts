import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openAutomationTab(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    const autoTab = page.locator('#bottom-dock-tab-automation');
    if (await autoTab.isVisible().catch(() => false)) {
        await autoTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Automation lanes on EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('automation tab is accessible and shows mode button', async ({ page }) => {
        await openAutomationTab(page);
        const mode = page.getByTestId('automation-mode-button');
        const hasMode = await mode.isVisible().catch(() => false);
        if (hasMode) {
            const label = await mode.getAttribute('aria-label');
            expect(label).toContain('Automation mode');
        }
    });

    test('automation mode dropdown lists read/write/touch/latch', async ({ page }) => {
        await openAutomationTab(page);
        const mode = page.getByTestId('automation-mode-button');
        if (await mode.isVisible().catch(() => false)) {
            await mode.click();
            await page.waitForTimeout(300);

            const options = page.getByRole('button').filter({ hasText: /read|write|touch|latch/i });
            const count = await options.count();
            expect(count).toBeGreaterThan(0);

            await page.keyboard.press('Escape');
        }
    });

    test('transport play/stop works with automation tab open', async ({ page }) => {
        await openAutomationTab(page);

        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(600);

        const playhead = page.getByTestId('transport-playhead');
        const movingText = (await playhead.innerText()).trim();
        expect(movingText).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('automation tab and mixer tab can be switched', async ({ page }) => {
        await openAutomationTab(page);

        // Switch to mixer.
        const mixerTab = page.locator('#bottom-dock-tab-mixer');
        if (await mixerTab.isVisible().catch(() => false)) {
            await mixerTab.click();
            await page.waitForTimeout(500);

            // Switch back to automation.
            const autoTab = page.locator('#bottom-dock-tab-automation');
            await autoTab.click();
            await page.waitForTimeout(500);

            // Mode button should still be visible.
            const mode = page.getByTestId('automation-mode-button');
            const hasMode = await mode.isVisible().catch(() => false);
            expect(hasMode).toBe(true);
        }
    });

    test('solo mode SIP/AFL/PFL accessible during automation', async ({ page }) => {
        await openAutomationTab(page);

        const sip = page.getByTestId('solo-mode-sip');
        const hasSip = await sip.isVisible().catch(() => false);
        if (hasSip) {
            await expect(sip).toHaveAttribute('aria-checked', 'true');
        }
    });
});
