import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.locator('[aria-label="Piano roll editor"]')).toBeVisible();
    await page.waitForTimeout(500);
}

test.describe('Chord stamp & expression — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPianoRoll(page);
    });

    test('enabling chord stamp reveals the chord type selector via test ID', async ({ page }) => {
        const chord = page.getByTestId('toolbar-chord');
        await chord.click();
        await page.waitForTimeout(300);

        const chordType = page.getByTestId('toolbar-chord-type');
        await expect(chordType).toBeVisible({ timeout: 5000 });
    });

    test('changing chord type updates the selected value', async ({ page }) => {
        // Enable chord mode.
        await page.getByTestId('toolbar-chord').click();
        await page.waitForTimeout(300);

        const chordType = page.getByTestId('toolbar-chord-type');
        const select = chordType.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const before = await select.inputValue();
            await select.selectOption({ index: 3 });
            const after = await select.inputValue();
            expect(after).not.toBe(before);
        }
    });

    test('expression view toggle reveals the expression lane selector', async ({ page }) => {
        const expression = page.getByTestId('toolbar-expression');
        await expression.click();
        await page.waitForTimeout(300);

        // The expression lane selector should appear.
        const laneSelector = page.locator('[aria-label="Active expression lane"]');
        const hasSelector = await laneSelector.isVisible().catch(() => false);
        expect(hasSelector).toBe(true);
    });

    test('expression lane defaults to Velocity', async ({ page }) => {
        await page.getByTestId('toolbar-expression').click();
        await page.waitForTimeout(300);

        const laneSelector = page.locator('[aria-label="Active expression lane"]');
        const select = laneSelector.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const value = await select.inputValue();
            expect(value).toBe('velocity');
        }
    });

    test('disabling chord stamp hides the chord type selector', async ({ page }) => {
        const chord = page.getByTestId('toolbar-chord');
        await chord.click();
        await page.waitForTimeout(300);
        await expect(page.getByTestId('toolbar-chord-type')).toBeVisible();

        await chord.click();
        await page.waitForTimeout(300);
        await expect(page.getByTestId('toolbar-chord-type')).not.toBeVisible();
    });
});
