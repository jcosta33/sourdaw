import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Bottom Dock — Routing & Analysis', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
    });

    test('Can switch to the Routing tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-routing').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        await expect(panel).not.toContainText(/No content|Empty/i);
    });

    test('Can switch to the Analysis tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-analysis').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });

    test('Can switch to the Editor tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-editor').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });

    test('Can switch to the Automation tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-automation').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });

    test('Can switch between tabs rapidly', async ({ page }) => {
        const panel = page.locator('#bottom-dock-tabpanel');

        await page.locator('#bottom-dock-tab-routing').click();
        await expect(panel).toBeVisible();

        await page.locator('#bottom-dock-tab-analysis').click();
        await expect(panel).toBeVisible();

        await page.locator('#bottom-dock-tab-mixer').click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();
    });

    test('Can close the bottom dock from any tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-routing').click();
        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeHidden();
    });
});
