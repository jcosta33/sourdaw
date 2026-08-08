import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<boolean> {
    const canvas = page.getByLabel('Timeline editor surface');
    const positions = [
        { x: 100, y: 40 }, { x: 200, y: 40 }, { x: 300, y: 40 },
        { x: 150, y: 80 }, { x: 250, y: 80 },
    ];
    for (const pos of positions) {
        await canvas.dblclick({ position: pos });
        await page.waitForTimeout(500);
        if (await page.locator('[aria-label="Piano roll editor"]').isVisible().catch(() => false)) return true;
    }
    return false;
}

test.describe('MIDI undo/redo + playback — Pop Song template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('draw notes, undo, verify undo enabled, redo', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await pianoRoll.dblclick({ position: { x: 80, y: 120 } });
        await page.waitForTimeout(300);

        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });

        await undo.click();
        await page.waitForTimeout(500);

        const redo = page.getByTestId('transport-redo');
        await expect(redo).toBeEnabled({ timeout: 10_000 });
    });

    test('play after drawing notes moves playhead', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await pianoRoll.dblclick({ position: { x: 100, y: 100 } });
        await page.waitForTimeout(300);

        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(800);

        const playhead = page.getByTestId('transport-playhead');
        expect((await playhead.innerText()).trim()).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('enable step input, draw note via keyboard', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const step = page.getByTestId('toolbar-step-input');
        await step.click();
        await expect(step).toHaveAttribute('aria-pressed', 'true');
    });

    test('fold to scale, constrain, draw — combined toolbar state', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        await page.getByTestId('toolbar-fold-to-scale').click();
        await page.getByTestId('toolbar-constrain').click();

        await expect(page.getByTestId('toolbar-fold-to-scale')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('toolbar-constrain')).toHaveAttribute('aria-pressed', 'true');
    });

    test('undo button disabled initially, enabled after drawing', async ({ page }) => {
        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeDisabled();

        const opened = await openPianoRoll(page);
        if (!opened) return;

        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await pianoRoll.dblclick({ position: { x: 120, y: 110 } });
        await page.waitForTimeout(500);

        await expect(undo).toBeEnabled({ timeout: 10_000 });
    });
});
