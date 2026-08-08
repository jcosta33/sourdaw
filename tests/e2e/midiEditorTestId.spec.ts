import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function createMidiTrackAndClip(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();

    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });

    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });

    const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
    await expect(addClipItem).toBeVisible();
    await addClipItem.click();
    await page.waitForTimeout(500);
}

async function openPianoRoll(page: import('@playwright/test').Page): Promise<void> {
    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
    await expect(pianoRoll).toBeVisible();
    await page.waitForTimeout(500);
}

test.describe('MIDI Editor toolbar — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await createMidiTrackAndClip(page);
        await openPianoRoll(page);
    });

    test('paint mode toggles aria-pressed on → off', async ({ page }) => {
        const paint = page.getByTestId('toolbar-paint');
        await expect(paint).toBeVisible();
        await expect(paint).toHaveAttribute('aria-pressed', 'false');

        await paint.click();
        await expect(paint).toHaveAttribute('aria-pressed', 'true');

        await paint.click();
        await expect(paint).toHaveAttribute('aria-pressed', 'false');
    });

    test('ghost notes toggle round-trips aria-pressed', async ({ page }) => {
        const ghost = page.getByTestId('toolbar-ghost');
        await expect(ghost).toBeVisible();

        const before = await ghost.getAttribute('aria-pressed');
        await ghost.click();
        await expect(ghost).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('fold-to-scale toggle round-trips aria-pressed', async ({ page }) => {
        const fold = page.getByTestId('toolbar-fold-to-scale');
        await expect(fold).toBeVisible();
        await expect(fold).toHaveAttribute('aria-pressed', 'false');

        await fold.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'true');

        await fold.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'false');
    });

    test('step input toggle round-trips aria-pressed', async ({ page }) => {
        const step = page.getByTestId('toolbar-step-input');
        await expect(step).toBeVisible();
        await expect(step).toHaveAttribute('aria-pressed', 'false');

        await step.click();
        await expect(step).toHaveAttribute('aria-pressed', 'true');

        await step.click();
        await expect(step).toHaveAttribute('aria-pressed', 'false');
    });

    test('constrain-to-scale toggle round-trips aria-pressed', async ({ page }) => {
        const constrain = page.getByTestId('toolbar-constrain');
        await expect(constrain).toBeVisible();
        await expect(constrain).toHaveAttribute('aria-pressed', 'false');

        await constrain.click();
        await expect(constrain).toHaveAttribute('aria-pressed', 'true');
    });

    test('chord stamp toggle round-trips aria-pressed', async ({ page }) => {
        const chord = page.getByTestId('toolbar-chord');
        await expect(chord).toBeVisible();
        await expect(chord).toHaveAttribute('aria-pressed', 'false');

        await chord.click();
        await expect(chord).toHaveAttribute('aria-pressed', 'true');

        await chord.click();
        await expect(chord).toHaveAttribute('aria-pressed', 'false');
    });

    test('expression view toggle round-trips aria-pressed', async ({ page }) => {
        const expression = page.getByTestId('toolbar-expression');
        await expect(expression).toBeVisible();

        const before = await expression.getAttribute('aria-pressed');
        await expression.click();
        await expect(expression).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('drawing notes in piano roll enables undo', async ({ page }) => {
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');

        // Draw 3 notes.
        await pianoRoll.dblclick({ position: { x: 80, y: 120 } });
        await page.waitForTimeout(200);
        await pianoRoll.dblclick({ position: { x: 160, y: 140 } });
        await page.waitForTimeout(200);
        await pianoRoll.dblclick({ position: { x: 240, y: 100 } });
        await page.waitForTimeout(300);

        // Undo must be enabled.
        const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undoButton).not.toBeDisabled();

        // Undo one note.
        await undoButton.click();
        await page.waitForTimeout(300);

        // Redo must now be enabled.
        const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
        await expect(redoButton).not.toBeDisabled();
    });
});
