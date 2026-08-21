import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
    await trackList.getByText('MIDI', { exact: true }).click();
}

async function openInspector(page: Page): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle inspector' });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
        await toggle.click();
    }
    await expect(page.getByRole('complementary', { name: 'Inspector panel' })).toBeVisible();
}

async function addGainLane(page: Page): Promise<void> {
    await openInspector(page);
    const addLane = page.getByRole('complementary', { name: 'Inspector panel' }).getByRole('button', {
        name: 'Add automation lane',
    });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await addLane.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const trackGain = menu
        .getByText('Track', { exact: true })
        .locator('xpath=following-sibling::button[@role="menuitem"][1]');
    await expect(trackGain).toHaveText('Gain');
    await trackGain.click();
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Automation point draw, delete, and undo', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
        await addGainLane(page);
        await openBottomTab(page, 'Automation');
    });

    test('drawing adds a point and double-click deletes it with an undo round-trip', async ({ page }) => {
        await page.getByRole('radio', { name: 'Draw (D/B)' }).click();
        const panel = page.getByRole('tabpanel', { name: 'Automation' });
        await expect(panel.getByRole('button', { name: 'Remove Gain lane' })).toBeVisible();
        await expect(panel.getByText('DRAW', { exact: true })).toBeVisible();
        const svg = panel.getByRole('img');
        await expect(svg).toBeVisible();

        const points = svg.locator('[data-auto-point]');
        await expect(points).toHaveCount(0);

        const box = await svg.boundingBox();
        if (!box) {
            throw new Error('Gain automation lane SVG has no bounding box');
        }
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
        await page.mouse.down();
        await page.mouse.up();
        await expect(points).toHaveCount(1);

        await points.dblclick();
        await expect(points).toHaveCount(0);

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(points).toHaveCount(1);

        await expect(redo).toBeEnabled();
        await redo.click();
        await expect(points).toHaveCount(0);
    });
});
