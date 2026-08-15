import { test, expect, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function selectFirstTrack(page: Page): Promise<void> {
    const row = page.getByRole('grid', { name: /Track list/i }).first().getByRole('row').first();
    await row.waitFor({ state: 'visible' });
    await row.click();
}

async function addGainLane(page: Page): Promise<void> {
    // The Add-automation-lane control lives in the inspector's Automation
    // section for the selected track.
    const addLane = page.getByRole('button', { name: 'Add automation lane' });
    await expect(addLane).toBeVisible({ timeout: 10_000 });
    await addLane.click();
    await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
}

async function openAutomationTab(page: Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    await page.locator('#bottom-dock-tab-automation').click();
    await page.waitForTimeout(500);
}

// Automation points are DOM elements (SVG groups with data-auto-point), so
// the write path is assertable without canvas scraping: drawing adds a
// point, double-click deletes it with an undo entry, and transport undo/redo
// round-trips the deletion.
test.describe('Automation point draw, delete, and undo', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'EDM' });
        await selectFirstTrack(page);
        await addGainLane(page);
        await openAutomationTab(page);
    });

    test('drawing adds a point and double-click deletes it with an undo round-trip', async ({ page }) => {
        // Select the Draw tool (toolbar radio; D/B shortcut). Draw mode also
        // marks the lane svg with cursor-cell, which identifies it — a fresh
        // lane has no points yet for a has-point locator to find.
        await page.getByRole('radio', { name: 'Draw (D/B)' }).click();
        const svg = page.locator('svg.cursor-cell').first();
        await expect(svg).toBeVisible();

        const points = svg.locator('[data-auto-point]');
        await expect(points).toHaveCount(0);

        // Draw one point: a stationary press paints exactly one point — any
        // drag risks crossing a snap gridline and painting a second.
        const box = await svg.boundingBox();
        expect(box).not.toBeNull();
        const x = box!.x + box!.width * 0.5;
        const y = box!.y + box!.height * 0.3;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
        await expect(points).toHaveCount(1);

        // Double-click the drawn point: deletion pushes an undo entry.
        await points.first().dblclick();
        await expect(points).toHaveCount(0);

        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(points).toHaveCount(1);

        await redo.click();
        await expect(points).toHaveCount(0);
    });
});
