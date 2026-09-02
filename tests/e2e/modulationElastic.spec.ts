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

    test('Modulation tab shows modulation matrix region', async ({ page }) => {
        await page.locator('#bottom-dock-tab-modulation').click();
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        await expect(matrix).toBeVisible({ timeout: 5000 });
    });

    test('Automation tab shows automation content', async ({ page }) => {
        await page.locator('#bottom-dock-tab-automation').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('Elastic tab stays absent with a MIDI clip selected', async ({ page }) => {
        // AppShell renders the tab only when `isAudioClipSelected` is true
        // (src/modules/WorkspaceShell/presentations/views/AppShell.tsx); the
        // tab is gated on the selected clip's type, so a selected MIDI clip
        // must not show it.
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);
        await timeline.dblclick({ position: { x: 300, y: 30 } });
        await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });

        const elastic_tab = page.locator('#bottom-dock-tab-elastic');
        await expect(elastic_tab).toHaveCount(0);
    });

    test('Can switch modulation → automation → mixer with content each time', async ({ page }) => {
        await page.locator('#bottom-dock-tab-modulation').click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible();
        await expect(page.getByRole('region', { name: 'Modulation matrix' })).toBeVisible({ timeout: 5000 });

        await page.locator('#bottom-dock-tab-automation').click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible();

        await page.locator('#bottom-dock-tab-mixer').click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();
    });

    test('Can close bottom dock from modulation tab', async ({ page }) => {
        await page.locator('#bottom-dock-tab-modulation').click();
        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeHidden();
    });
});
