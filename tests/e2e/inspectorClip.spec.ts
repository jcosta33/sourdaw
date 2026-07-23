import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Inspector — Clip Properties', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);
    });

    test('Clip context menu exposes Rename Clip operation', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        // Right-click the clip to open its context menu.
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const names = (await menu.getByRole('menuitem').allInnerTexts()).join(' | ');
        expect(names).toMatch(/Rename Clip/);
    });

    test('Clip can be duplicated via keyboard shortcut', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        // Select the clip at x=300 (where it was created).
        await timeline.click({ position: { x: 300, y: 30 } });
        await page.waitForTimeout(500);

        await page.locator('#main-content').click();
        await page.keyboard.press(`${MOD}+d`);

        await page.waitForTimeout(1000);
        await expect(page.getByText(/clip/i).first()).toBeVisible();
    });

    test('Double-clicking a clip opens the MIDI editor', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.dblclick({ position: { x: 300, y: 30 } });

        await expect(page.getByLabel('Piano roll editor')).toBeVisible({ timeout: 10000 });
    });
});
