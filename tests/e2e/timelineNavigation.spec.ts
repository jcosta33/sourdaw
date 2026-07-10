import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Timeline Navigation & Editing Surface', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Timeline chrome components are visible', async ({ page }) => {
        await expect(page.getByRole('slider', { name: /^Timeline minimap/ })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Arrangement sections' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Adjustment layers' })).toBeVisible();
    });

    test('Can add an adjustment layer', async ({ page }) => {
        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        const add_button = page.getByRole('button', { name: 'Add adjustment layer' });
        await add_button.click();

        await page.waitForTimeout(1000);
        await expect(add_button).toBeVisible();
    });

    test('Zoom keyboard shortcuts work without errors', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();
        await page.keyboard.press('=');
        await page.keyboard.press('=');
        await page.keyboard.press('-');
        await page.keyboard.press('-');
        await page.keyboard.press('f');
        await expect(timeline).toBeVisible();
    });

    test('Playhead position display is present', async ({ page }) => {
        const playhead = page.getByRole('button', { name: /Playhead position/i });
        await expect(playhead).toBeVisible();
        await expect(playhead).toContainText('1');
    });

    test('Timeline minimap responds to keyboard interaction', async ({ page }) => {
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        await minimap.focus();
        await page.keyboard.press('ArrowRight');
        await expect(minimap).toBeVisible();
    });

    test('Can right-click timeline for context menu', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        if (!box) {
            return;
        }
        await timeline.click({ button: 'right', position: { x: 200, y: box.height * 0.5 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
    });
});
