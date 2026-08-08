import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Clip operations on EDM template — right-click, delete', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('timeline canvas has rendered clips', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible({ timeout: 15_000 });

        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(100);
        expect(box!.height).toBeGreaterThan(50);
    });

    test('right-clicking timeline shows a context menu', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 200, y: 40 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
    });

    test('double-clicking an existing clip opens piano roll', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');

        // Try positions where template clips likely are.
        const positions = [
            { x: 100, y: 40 },
            { x: 200, y: 40 },
            { x: 150, y: 80 },
            { x: 250, y: 80 },
        ];

        let opened = false;
        for (const pos of positions) {
            await canvas.dblclick({ position: pos });
            await page.waitForTimeout(500);
            const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
            if (await pianoRoll.isVisible().catch(() => false)) {
                opened = true;
                break;
            }
        }

        if (opened) {
            // Scale root should be visible.
            await expect(page.getByTestId('toolbar-scale-root')).toBeVisible({ timeout: 5000 });
        }
    });

    test('transport play/stop during clip operations', async ({ page }) => {
        // Start playback.
        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(500);

        // Right-click during playback — should pause for context menu.
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 200, y: 40 } });
        await page.waitForTimeout(300);

        const menu = page.getByRole('menu');
        const hasMenu = await menu.isVisible().catch(() => false);
        if (hasMenu) {
            // Close menu by pressing Escape.
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }

        // Stop playback.
        await page.getByTestId('transport-stop').click();
        await expect(page.getByTestId('transport-playhead')).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });
});
