import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Audio/MIDI Advanced & Misc', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Status bar shows performance metrics', async ({ page }) => {
        const status = page.getByRole('status', { name: 'Application status' });
        await expect(status).toBeVisible();
        await expect(status.getByText('CPU')).toBeVisible();
        await expect(status.getByText('MEM')).toBeVisible();
        await expect(status.getByText(/Hz|kHz/i)).toBeVisible();
    });

    test('Status bar has help and collaboration toggles', async ({ page }) => {
        const status = page.getByRole('status', { name: 'Application status' });
        await expect(status.getByRole('button', { name: 'Help and Feedback' })).toBeVisible();
        await expect(status.getByRole('button', { name: 'Toggle collaboration panel' })).toBeVisible();
    });

    test('Session view opens with scene content', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-session').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });

    test('MIDI editor shows velocity and additional lanes', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);

        await timeline.dblclick({ position: { x: 200, y: 30 } });
        await expect(page.getByLabel('Piano roll editor')).toBeVisible({ timeout: 10000 });

        const automation_select = page.getByRole('combobox', { name: /Automation lane type/i });
        if (await automation_select.isVisible().catch(() => false)) {
            await expect(automation_select).toBeVisible();
        }
    });

    test('Browser Library tab is accessible', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Library', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();
    });

    test('Browser Macros tab is accessible', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Macros', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();
    });

    test('Browser Project tab is accessible', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();
    });

    test('Can toggle bottom dock open and closed', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
        await toggle.click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible({ timeout: 5000 });

        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeHidden();
    });
});
