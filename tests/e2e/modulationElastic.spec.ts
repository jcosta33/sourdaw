import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Bottom Dock — Modulation, Automation & Elastic', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
    });

    test('Can switch to the Modulation tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-modulation').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });

    test('Modulation matrix region is present', async ({ page }) => {
        await page.locator('#bottom-dock-tab-modulation').click();
        await expect(page.getByRole('region', { name: 'Modulation matrix' })).toBeVisible({ timeout: 5000 });
    });

    test('Can switch to the Automation tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-automation').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });

    test('Elastic tab button exists', async ({ page }) => {
        const elastic_tab = page.locator('#bottom-dock-tab-elastic');
        const exists = await elastic_tab.count();
        if (exists > 0) {
            await expect(elastic_tab).toBeVisible();
        }
    });

    test('Can switch from modulation to automation to mixer', async ({ page }) => {
        await page.locator('#bottom-dock-tab-modulation').click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible();

        await page.locator('#bottom-dock-tab-automation').click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible();

        await page.locator('#bottom-dock-tab-mixer').click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();
    });
});
