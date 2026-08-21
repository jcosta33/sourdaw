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

test.describe('MIDI note velocity and piano-roll chrome', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await openPianoRollOnNewClip(page);
    });

    test('stamping a note on the piano roll round-trips through undo and redo', async ({ page }) => {
        const pianoRoll = page.getByLabel('Piano roll editor');
        const noteCount = page.getByLabel(/notes? in /i);
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        const paint = page.getByRole('button', { name: 'Toggle paint mode' });

        await expect(noteCount).toHaveText('0 notes');
        await expect(paint).not.toHaveAttribute('aria-pressed', 'true');
        await paint.click();
        await expect(paint).toHaveAttribute('aria-pressed', 'true');

        await pianoRoll.click({ position: { x: 200, y: 130 } });
        await expect(noteCount).toHaveText('1 note');
        await expect(undo).toBeEnabled();

        await undo.click();
        await expect(noteCount).toHaveText('0 notes');
        await expect(redo).toBeEnabled();

        await redo.click();
        await expect(noteCount).toHaveText('1 note');
    });

    test('Expression view opens the velocity lane by default', async ({ page }) => {
        const toggle = page.getByRole('button', { name: /Toggle Expression View/i });
        const lane = page.getByRole('combobox', { name: 'Active expression lane' });

        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(lane).toHaveCount(0);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(lane).toBeVisible();
        await expect(lane).toHaveValue('velocity');
        await expect(lane.getByRole('option', { name: 'Velocity', exact: true })).toHaveCount(1);

        await toggle.click();
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(lane).toHaveCount(0);
    });

    test('scale root and type selectors hold a value', async ({ page }) => {
        const root = page.getByRole('combobox', { name: 'Scale root note' });
        const type = page.getByRole('combobox', { name: 'Scale type' });

        await expect(root).toBeVisible();
        await expect(type).toBeVisible();
        await expect(root).not.toHaveValue('');
        await expect(type).not.toHaveValue('');
    });

    test('zoom slider exposes a numeric value that keyboard input can raise', async ({ page }) => {
        const zoom = page.getByRole('slider', { name: 'Piano roll zoom' });
        await expect(zoom).toBeVisible();

        const before = Number(await zoom.getAttribute('aria-valuenow'));
        expect(before).toBeGreaterThanOrEqual(25);
        expect(before).toBeLessThanOrEqual(400);

        await zoom.focus();
        await page.keyboard.press('ArrowRight');
        await expect(zoom).toHaveAttribute('aria-valuenow', String(before + 25));
    });
});
