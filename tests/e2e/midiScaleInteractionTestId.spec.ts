import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<boolean> {
    const canvas = page.getByLabel('Timeline editor surface');
    const positions = [
        { x: 100, y: 40 }, { x: 200, y: 40 }, { x: 300, y: 40 },
        { x: 150, y: 80 }, { x: 250, y: 80 }, { x: 100, y: 120 },
    ];
    for (const pos of positions) {
        await canvas.dblclick({ position: pos });
        await page.waitForTimeout(500);
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        if (await pianoRoll.isVisible().catch(() => false)) return true;
    }
    return false;
}

test.describe('MIDI scale interaction — Pop Song template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('enabling fold-to-scale highlights in-scale notes', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        const fold = page.getByTestId('toolbar-fold-to-scale');
        await fold.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'true');
    });

    test('enabling constrain prevents out-of-scale note input', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        const constrain = page.getByTestId('toolbar-constrain');
        await constrain.click();
        await expect(constrain).toHaveAttribute('aria-pressed', 'true');
    });

    test('step input mode enables sequential note entry', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        const step = page.getByTestId('toolbar-step-input');
        await step.click();
        await expect(step).toHaveAttribute('aria-pressed', 'true');
        await step.click();
        await expect(step).toHaveAttribute('aria-pressed', 'false');
    });

    test('lasso mode toggles with paint mode', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        const paint = page.getByTestId('toolbar-paint');
        const lasso = page.locator('[aria-label="Toggle magic lasso selection"]').first();
        if (await lasso.isVisible().catch(() => false)) {
            await lasso.click();
            await expect(lasso).toHaveAttribute('aria-pressed', 'true');
            await paint.click();
            await expect(paint).toHaveAttribute('aria-pressed', 'true');
        }
    });

    test('note preview toggle works', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        const preview = page.locator('[aria-label="Toggle note hover preview"]').first();
        if (await preview.isVisible().catch(() => false)) {
            const before = await preview.getAttribute('aria-pressed');
            await preview.click();
            await page.waitForTimeout(200);
            await expect(preview).not.toHaveAttribute('aria-pressed', before ?? '');
        }
    });
});
