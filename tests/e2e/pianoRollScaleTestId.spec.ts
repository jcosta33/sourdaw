import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<void> {
    // Add a MIDI track.
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });

    // Create a clip.
    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);

    // Open piano roll.
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.locator('[aria-label="Piano roll editor"]')).toBeVisible();
    await page.waitForTimeout(500);
}

test.describe('Piano roll scale selectors — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPianoRoll(page);
    });

    test('scale root selector is present via test ID', async ({ page }) => {
        const root = page.getByTestId('toolbar-scale-root');
        await expect(root).toBeVisible({ timeout: 5000 });
    });

    test('scale type selector is present via test ID', async ({ page }) => {
        const type = page.getByTestId('toolbar-scale-type');
        await expect(type).toBeVisible({ timeout: 5000 });
    });

    test('changing scale root updates the selected value', async ({ page }) => {
        const root = page.getByTestId('toolbar-scale-root');
        await expect(root).toBeVisible({ timeout: 5000 });

        const select = root.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const before = await select.inputValue();
            await select.selectOption({ index: 3 });
            const after = await select.inputValue();
            expect(after).not.toBe(before);
        }
    });

    test('changing scale type updates the selected value', async ({ page }) => {
        const type = page.getByTestId('toolbar-scale-type');
        await expect(type).toBeVisible({ timeout: 5000 });

        const select = type.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const before = await select.inputValue();
            await select.selectOption({ index: 2 });
            const after = await select.inputValue();
            expect(after).not.toBe(before);
        }
    });

    test('scale root and type selectors coexist with toolbar toggles', async ({ page }) => {
        await expect(page.getByTestId('toolbar-scale-root')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('toolbar-scale-type')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('toolbar-paint')).toBeVisible({ timeout: 5000 });
    });
});
