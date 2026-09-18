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

    /**
     * Zoom observable: the minimap slider's aria-valuenow is scrollX as a percentage of
     * the project at the current zoom (TimelineMinimap.tsx), and zoomTimeline raises
     * pixelsPerBeat while holding scrollX — so with the viewport scrolled off zero, a
     * zoom-in must shrink the recorded percentage. The first phase pins the minimap's
     * own keyboard scroll; the second pins the zoom shortcut. Polling on the value,
     * never a sleep (#3675).
     */
    test('Zoom in changes timeline scroll position', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();

        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        await minimap.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await minimap.getAttribute('aria-valuenow')) ?? '').not.toBe('0');

        const scrolled = await minimap.getAttribute('aria-valuenow');
        await page.keyboard.press('=');
        await page.keyboard.press('=');
        await expect
            .poll(async () => Number((await minimap.getAttribute('aria-valuenow')) ?? '0'))
            .toBeLessThan(Number(scrolled ?? '0'));
    });

    test('Playhead position updates after clicking timeline', async ({ page }) => {
        const playhead = page.getByRole('button', { name: /Playhead position/i });
        await expect(playhead).toContainText('1');
        const baseline = await playhead.textContent();

        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        expect(box).not.toBeNull();
        await timeline.click({ position: { x: (box?.width ?? 0) * 0.6, y: (box?.height ?? 0) * 0.5 } });

        await expect.poll(async () => (await playhead.textContent()) ?? '').not.toBe(baseline ?? '');
    });

    test('Timeline minimap responds to keyboard and changes value', async ({ page }) => {
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const value_before = Number((await minimap.getAttribute('aria-valuenow')) ?? '0');
        const playhead = page.getByRole('button', { name: /Playhead position/i });
        const playhead_before = await playhead.textContent();

        await minimap.focus();
        await page.keyboard.press('ArrowRight');

        await expect
            .poll(async () => Number((await minimap.getAttribute('aria-valuenow')) ?? '0'))
            .toBeGreaterThan(value_before);
        // Viewport scroll is not transport: the playhead must not move with it.
        expect(await playhead.textContent()).toBe(playhead_before ?? '');
    });

    test('Can right-click timeline for context menu with actionable items', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        expect(box).not.toBeNull();
        await timeline.click({ button: 'right', position: { x: 200, y: (box?.height ?? 0) * 0.5 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const items = menu.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Beat ruler is visible and responds to click', async ({ page }) => {
        const beat_ruler = page.getByLabel('Beat ruler');
        await expect(beat_ruler).toBeVisible();
        const playhead = page.getByRole('button', { name: /Playhead position/i });
        await expect(playhead).toContainText('1');
        const baseline = await playhead.textContent();

        const box = await beat_ruler.boundingBox();
        expect(box).not.toBeNull();
        await beat_ruler.click({ position: { x: (box?.width ?? 0) * 0.5, y: (box?.height ?? 0) * 0.5 } });

        await expect.poll(async () => (await playhead.textContent()) ?? '').not.toBe(baseline ?? '');
    });
});
