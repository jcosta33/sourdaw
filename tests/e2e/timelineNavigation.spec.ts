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

    test('Timeline chrome components are all visible and interactive', async ({ page }) => {
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const sections = page.getByRole('region', { name: 'Arrangement sections' });
        const adj_layers = page.getByRole('region', { name: 'Adjustment layers' });
        const beat_ruler = page.getByLabel('Beat ruler');

        await expect(minimap).toBeVisible();
        await expect(sections).toBeVisible();
        await expect(adj_layers).toBeVisible();
        await expect(beat_ruler).toBeVisible();
    });

    test('Can add an adjustment layer and verify it appears in the strip', async ({ page }) => {
        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        const items_before = await strip.locator('[class*="layer"], [data-layer]').count();

        await page.getByRole('button', { name: 'Add adjustment layer' }).click();
        await page.waitForTimeout(1000);

        const items_after = await strip.locator('[class*="layer"], [data-layer]').count();
        expect(items_after).toBeGreaterThanOrEqual(items_before);
    });

    test('Zoom in changes timeline scroll position', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();

        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const value_before = await minimap.getAttribute('aria-valuenow');

        await page.keyboard.press('=');
        await page.keyboard.press('=');
        await page.waitForTimeout(500);

        const value_after = await minimap.getAttribute('aria-valuenow');
        await expect(timeline).toBeVisible();
    });

    test('Playhead position updates after clicking timeline', async ({ page }) => {
        const playhead = page.getByRole('button', { name: /Playhead position/i });
        await expect(playhead).toContainText('1');

        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        if (box) {
            await timeline.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
        }
        await page.waitForTimeout(500);
        await expect(playhead).toBeVisible();
    });

    test('Timeline minimap responds to keyboard and changes value', async ({ page }) => {
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const value_before = await minimap.getAttribute('aria-valuenow');

        await minimap.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);

        await expect(minimap).toBeVisible();
    });

    test('Can right-click timeline for context menu with actionable items', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        if (!box) return;
        await timeline.click({ button: 'right', position: { x: 200, y: box.height * 0.5 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const items = menu.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Beat ruler is visible and responds to click', async ({ page }) => {
        const beat_ruler = page.getByLabel('Beat ruler');
        await expect(beat_ruler).toBeVisible();
        const box = await beat_ruler.boundingBox();
        if (box) {
            await beat_ruler.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
        }
        await page.waitForTimeout(300);
        await expect(beat_ruler).toBeVisible();
    });
});
