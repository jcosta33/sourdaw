import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Transport toggles — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('auto-scroll toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const autoScroll = page.getByTestId('transport-auto-scroll');
        await expect(autoScroll).toBeVisible();

        await expect(autoScroll).toHaveAttribute('aria-pressed', 'true');

        await autoScroll.click();
        await expect(autoScroll).toHaveAttribute('aria-pressed', 'false');

        await autoScroll.click();
        await expect(autoScroll).toHaveAttribute('aria-pressed', 'true');
    });

    test('undo and redo buttons are present via test IDs', async ({ page }) => {
        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');

        await expect(undo).toBeVisible();
        await expect(redo).toBeVisible();

        // Both should be disabled initially (no actions yet).
        await expect(undo).toBeDisabled();
        await expect(redo).toBeDisabled();
    });

    test('undo button becomes enabled after drawing MIDI notes', async ({ page }) => {
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

        // Open piano roll and draw a note.
        await canvas.dblclick({ position: { x: 300, y: 30 } });
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await expect(pianoRoll).toBeVisible();
        await page.waitForTimeout(500);

        await pianoRoll.dblclick({ position: { x: 100, y: 100 } });
        await page.waitForTimeout(500);

        // Undo should now be enabled.
        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });
    });
});
