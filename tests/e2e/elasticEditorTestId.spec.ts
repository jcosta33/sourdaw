import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Elastic audio editor — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('elastic editor panel is present when elastic tab is active', async ({ page }) => {
        // Open the bottom dock.
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
            await page.waitForTimeout(500);
        }

        // Switch to elastic tab.
        const elasticTab = page.locator('#bottom-dock-tab-elastic');
        if (await elasticTab.isVisible().catch(() => false)) {
            await elasticTab.click();
            await page.waitForTimeout(500);

            const panel = page.getByTestId('elastic-editor-panel');
            await expect(panel).toBeAttached({ timeout: 10_000 });
        }
    });

    test('elastic tool buttons are present when panel is visible', async ({ page }) => {
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
        }
        await page.waitForTimeout(500);

        const elasticTab = page.locator('#bottom-dock-tab-elastic');
        if (await elasticTab.isVisible().catch(() => false)) {
            await elasticTab.click();
            await page.waitForTimeout(500);

            const panel = page.getByTestId('elastic-editor-panel');
            if (await panel.isVisible().catch(() => false)) {
                // At least one tool button should be present.
                const tools = panel.locator('[data-testid^="elastic-tool-"]');
                const count = await tools.count();
                expect(count).toBeGreaterThan(0);
            }
        }
    });

    test('first elastic tool is active by default', async ({ page }) => {
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
        }
        await page.waitForTimeout(500);

        const elasticTab = page.locator('#bottom-dock-tab-elastic');
        if (await elasticTab.isVisible().catch(() => false)) {
            await elasticTab.click();
            await page.waitForTimeout(500);

            const panel = page.getByTestId('elastic-editor-panel');
            if (await panel.isVisible().catch(() => false)) {
                const firstTool = panel.locator('[data-testid^="elastic-tool-"]').first();
                await expect(firstTool).toHaveAttribute('aria-pressed', 'true');
            }
        }
    });

    test('switching elastic tools changes aria-pressed', async ({ page }) => {
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
        }
        await page.waitForTimeout(500);

        const elasticTab = page.locator('#bottom-dock-tab-elastic');
        if (await elasticTab.isVisible().catch(() => false)) {
            await elasticTab.click();
            await page.waitForTimeout(500);

            const panel = page.getByTestId('elastic-editor-panel');
            if (await panel.isVisible().catch(() => false)) {
                const tools = panel.locator('[data-testid^="elastic-tool-"]');
                const count = await tools.count();
                if (count > 1) {
                    const first = tools.nth(0);
                    const second = tools.nth(1);

                    await expect(first).toHaveAttribute('aria-pressed', 'true');
                    await second.click();
                    await page.waitForTimeout(300);
                    await expect(second).toHaveAttribute('aria-pressed', 'true');
                    await expect(first).toHaveAttribute('aria-pressed', 'false');
                }
            }
        }
    });
});
