import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
}

test.describe('Undo/Redo History', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can perform an action and revert it using the undo button', async ({ page }) => {
        await addMidiTrack(page);
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const midiRow = trackList.getByRole('row').filter({ hasText: /MIDI/i });
        await expect(midiRow.first()).toBeVisible();

        await page.getByRole('button', { name: /Toggle undo history panel/i }).click();
        await expect(page.getByText('Undo History', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Add midi track/i })).toBeVisible();

        const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undoButton).toBeEnabled();
        await undoButton.click();

        await expect(midiRow).toHaveCount(0);
        await expect(undoButton).toBeDisabled();
        await expect(page.getByText('Redo', { exact: true })).toBeVisible();
    });
});
