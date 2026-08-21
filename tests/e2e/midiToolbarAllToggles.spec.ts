import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
}

async function openPianoRollOnNewClip(page: Page): Promise<void> {
    await addMidiTrack(page);
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
}

test.describe('Piano roll toolbar toggles', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await openPianoRollOnNewClip(page);
    });

    test('Fold, Constrain, and Paint round-trip through pressed', async ({ page }) => {
        const fold = page.getByRole('button', { name: 'Toggle fold to scale', exact: true });
        const constrain = page.getByRole('button', { name: 'Constrain notes to scale', exact: true });
        const paint = page.getByRole('button', { name: 'Toggle paint mode', exact: true });

        await expect(fold).not.toHaveAttribute('aria-pressed', 'true');
        await expect(constrain).not.toHaveAttribute('aria-pressed', 'true');
        await expect(paint).not.toHaveAttribute('aria-pressed', 'true');

        await fold.click();
        await constrain.click();
        await paint.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'true');
        await expect(constrain).toHaveAttribute('aria-pressed', 'true');
        await expect(paint).toHaveAttribute('aria-pressed', 'true');

        await fold.click();
        await constrain.click();
        await paint.click();
        await expect(fold).not.toHaveAttribute('aria-pressed', 'true');
        await expect(constrain).not.toHaveAttribute('aria-pressed', 'true');
        await expect(paint).not.toHaveAttribute('aria-pressed', 'true');
    });

    test('Chord stamp reveals Chord type and hides it when Chord turns off', async ({ page }) => {
        const chord = page.getByRole('button', { name: 'Toggle chord stamp mode', exact: true });
        const chordType = page.getByRole('combobox', { name: 'Chord type', exact: true });

        await expect(chord).not.toHaveAttribute('aria-pressed', 'true');
        await expect(chordType).toHaveCount(0);

        await chord.click();
        await expect(chord).toHaveAttribute('aria-pressed', 'true');
        await expect(chordType).toBeVisible();
        await expect(chordType).toHaveValue('major');

        await chordType.selectOption('minor');
        await expect(chordType).toHaveValue('minor');

        await chord.click();
        await expect(chord).not.toHaveAttribute('aria-pressed', 'true');
        await expect(chordType).toHaveCount(0);
    });

    test('Ghost starts on and Snap 1/8 becomes the exclusive snap', async ({ page }) => {
        const ghost = page.getByRole('button', { name: 'Toggle ghost notes', exact: true });
        const snap14 = page.getByRole('button', { name: '1/4', exact: true });
        const snap18 = page.getByRole('button', { name: '1/8', exact: true });

        await expect(ghost).toHaveAttribute('aria-pressed', 'true');
        await ghost.click();
        await expect(ghost).not.toHaveAttribute('aria-pressed', 'true');

        await expect(snap14).toHaveAttribute('aria-pressed', 'true');
        await expect(snap18).not.toHaveAttribute('aria-pressed', 'true');

        await snap18.click();
        await expect(snap18).toHaveAttribute('aria-pressed', 'true');
        await expect(snap14).not.toHaveAttribute('aria-pressed', 'true');
    });

    test('scale type changes from chromatic to major', async ({ page }) => {
        const type = page.getByRole('combobox', { name: 'Scale type', exact: true });
        await expect(type).toHaveValue('chromatic');
        await type.selectOption('major');
        await expect(type).toHaveValue('major');
    });
});
