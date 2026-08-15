import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openYeast(page: Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
    }
    await expect(search).toBeVisible({ timeout: 10_000 });
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: 'MIDI FX' }).click();
    await browser.getByRole('button', { name: 'Yeast' }).click();
    await expect(page.getByRole('button', { name: 'Close Yeast' })).toBeVisible();
}

// The tail of the groove extraction flow that the assignment-revert defect
// blocked: selecting the committed template from the panel must ASSIGN it
// (combobox follows, lifecycle controls mount), rename must update the
// option list, and delete must remove it.
test.describe('Yeast groove template assignment, rename, delete', () => {
    test('assigning the committed template mounts the lifecycle and rename/delete work', async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        // Seed an eligible clip: MIDI track, clip, quarter-beat stamps at the
        // pinned default zoom (see grooveExtractionCommit.spec.ts for the
        // beat math).
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i });
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Add Clip', exact: true }).click();
        await page.waitForTimeout(500);
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.dblclick({ position: { x: 100, y: 40 } });
        await page.waitForTimeout(800);
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        const zoom = page.getByTestId('toolbar-zoom').getByRole('slider');
        await expect(zoom).toHaveAttribute('aria-valuenow', '100', { timeout: 5000 });
        for (const x of [50, 90, 130]) {
            await pianoRoll.click({ position: { x, y: 130 } });
            await page.waitForTimeout(150);
        }
        await expect(page.getByTestId('transport-undo')).toBeEnabled({ timeout: 5000 });

        // Groove processor on the Build deck, expanded.
        await openYeast(page);
        await page.getByRole('button', { name: /Build/ }).click();
        await page.getByRole('button', { name: '+ Groove' }).click();
        const grooveRow = page.locator('span', { hasText: 'Groove' }).last();
        await expect(grooveRow).toBeVisible({ timeout: 10_000 });
        await grooveRow.click();
        const combobox = page.getByRole('combobox', { name: 'Groove template' });
        await expect(combobox).toBeVisible();

        // Extract and commit at 1/8.
        await page.getByRole('combobox', { name: 'Groove extraction subdivision' }).selectOption('1/8');
        const clipSelect = page.getByRole('combobox', { name: 'MIDI clip for groove extraction' });
        const optionCount = await clipSelect.locator('option').count();
        const status = page
            .getByLabel('Extract groove from MIDI clip')
            .locator('xpath=ancestor::div[1]')
            .locator('[role="status"]');
        for (let index = 1; index < optionCount; index += 1) {
            await clipSelect.selectOption({ index });
            await page.getByRole('button', { name: 'Preview groove' }).click();
            await expect(status).toBeVisible({ timeout: 10_000 });
            const message = await status.innerText();
            if (!/no notes|empty|straight/i.test(message)) {
                break;
            }
        }
        await page.getByRole('button', { name: 'Save groove' }).click();
        await expect(page.getByRole('button', { name: 'Save groove' })).toHaveCount(0, { timeout: 10_000 });
        const options = await combobox.locator('option').allTextContents();
        const added = options.filter((text) => /groove/i.test(text) && !/Straight/i.test(text));
        expect(added).toHaveLength(1);

        // ASSIGN from the panel — the formerly-defective step.
        await combobox.selectOption({ label: added[0]! });
        await expect(combobox).toHaveValue(/groove-clip-/, { timeout: 10_000 });
        const nameInput = page.getByRole('textbox', { name: 'Groove template name' });
        await expect(nameInput).toBeVisible({ timeout: 10_000 });
        await expect(nameInput).toHaveValue(added[0]!);

        // Rename: the option list follows. Options inside a closed select
        // report hidden, so presence is asserted by count.
        await nameInput.fill('Renamed groove');
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await expect(page.getByRole('option', { name: 'Renamed groove' })).toHaveCount(1, { timeout: 10_000 });
        await expect(page.getByRole('option', { name: added[0]!, exact: true })).toHaveCount(0);

        // Delete: the option disappears.
        await page.getByRole('button', { name: 'Delete template' }).click();
        await expect(page.getByRole('option', { name: 'Renamed groove' })).toHaveCount(0, { timeout: 10_000 });
    });
});
