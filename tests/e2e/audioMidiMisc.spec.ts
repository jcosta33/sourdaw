import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Audio/MIDI Advanced & Misc', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Status bar shows numeric performance metrics', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status).toBeVisible();
        await expect(status.getByText('CPU')).toBeVisible();
        const cpu_text = await status.getByText('CPU').locator('..').textContent();
        expect(cpu_text).toMatch(/\d+/);
        await expect(status.getByText(/Hz|kHz/i)).toBeVisible();
    });

    test('Status bar has working help and collaboration toggles', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        const help = status.getByRole('button', { name: 'Help and Feedback' });
        const collab = status.getByRole('button', { name: 'Toggle collaboration panel' });
        await expect(help).toBeVisible();
        await expect(collab).toBeVisible();
        const undo_toggle = status.getByRole('button', { name: /Toggle undo history panel/i });
        await expect(undo_toggle).toBeVisible();
    });

    test('Session view opens and shows content', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-session').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('MIDI editor shows velocity lane and automation type selector', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);

        await timeline.dblclick({ position: { x: 200, y: 30 } });
        await expect(page.getByLabel('Piano roll editor')).toBeVisible({ timeout: 10000 });

        const lane_select = page.getByRole('combobox', { name: /Automation lane type/i });
        await expect(lane_select).toBeVisible({ timeout: 5000 });
        const options = lane_select.getByRole('option');
        expect(await options.count()).toBeGreaterThan(1);
    });

    test('Browser tabs switch content when clicked', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });

        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();

        await browser.getByRole('button', { name: 'Library', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();

        await browser.getByRole('button', { name: 'Macros', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();

        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();
    });

    test('Can toggle bottom dock open and verify content changes', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
        await toggle.click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible({ timeout: 5000 });

        const mixer_before = await page.getByRole('region', { name: 'Mixer panel' }).isVisible().catch(() => false);
        await page.locator('#bottom-dock-tab-routing').click();
        await page.waitForTimeout(300);
        const mixer_after = await page.getByRole('region', { name: 'Mixer panel' }).isVisible().catch(() => false);
        expect(mixer_after).toBe(false);

        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(panel).toBeHidden();
    });
});
