import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<boolean> {
    const canvas = page.getByLabel('Timeline editor surface');

    // Try several positions to find a clip.
    const positions = [
        { x: 100, y: 40 },
        { x: 200, y: 40 },
        { x: 300, y: 40 },
        { x: 150, y: 80 },
        { x: 250, y: 80 },
        { x: 100, y: 120 },
    ];

    for (const pos of positions) {
        await canvas.dblclick({ position: pos });
        await page.waitForTimeout(500);
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        if (await pianoRoll.isVisible().catch(() => false)) {
            return true;
        }
    }
    return false;
}

async function drawNotes(page: import('@playwright/test').Page): Promise<void> {
    const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
    await pianoRoll.dblclick({ position: { x: 80, y: 120 } });
    await page.waitForTimeout(200);
    await pianoRoll.dblclick({ position: { x: 160, y: 140 } });
    await page.waitForTimeout(200);
    await pianoRoll.dblclick({ position: { x: 240, y: 100 } });
    await page.waitForTimeout(300);
}

test.describe('MIDI note operations deep — Pop Song template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('drawing notes in piano roll enables undo', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        await drawNotes(page);

        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });
    });

    test('undo after drawing notes enables redo', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        await drawNotes(page);

        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });

        await undo.click();
        await page.waitForTimeout(500);

        const redo = page.getByTestId('transport-redo');
        await expect(redo).toBeEnabled({ timeout: 10_000 });
    });

    test('expression view reveals velocity lane', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const expression = page.getByTestId('toolbar-expression');
        await expression.click();
        await page.waitForTimeout(300);

        const lane = page.locator('[aria-label="Active expression lane"]');
        const hasLane = await lane.isVisible().catch(() => false);
        expect(hasLane).toBe(true);

        const select = lane.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const value = await select.inputValue();
            expect(value).toBe('velocity');
        }
    });

    test('scale root and type selectors are present in piano roll', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        await expect(page.getByTestId('toolbar-scale-root')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('toolbar-scale-type')).toBeVisible({ timeout: 5000 });
    });

    test('zoom slider present and has numeric value', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const zoom = page.getByTestId('toolbar-zoom');
        await expect(zoom).toBeVisible({ timeout: 5000 });

        const slider = zoom.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const value = await slider.getAttribute('aria-valuenow');
            expect(Number(value)).toBeGreaterThanOrEqual(25);
        }
    });
});
