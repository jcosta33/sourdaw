import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openMixer(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    const mixerTab = page.locator('#bottom-dock-tab-mixer');
    if (await mixerTab.isVisible().catch(() => false)) {
        await mixerTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Mixer channel width — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await launch_from_template({ page, template_name: 'EDM' });
        await openMixer(page);
    });

    test('clicking the channel-width button cycles its aria-label', async ({ page }) => {
        const width = page.getByTestId('mixer-channel-width');
        await expect(width).toBeVisible({ timeout: 10_000 });

        const labelBefore = await width.getAttribute('aria-label');
        expect(labelBefore).toMatch(/Channel width:/);

        await width.click();
        await page.waitForTimeout(300);

        const labelAfter = await width.getAttribute('aria-label');
        expect(labelAfter).toMatch(/Channel width:/);
        // State change: the cycled width differs from the starting width.
        expect(labelAfter).not.toBe(labelBefore);
    });
});
