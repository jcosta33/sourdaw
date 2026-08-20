import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect(trackList.getByRole('row')).not.toHaveCount(before);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openInspector(page: Page): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle inspector' });
    if ((await toggle.getAttribute('aria-pressed')) === 'false') {
        await toggle.click();
    }
    await expect(page.getByRole('complementary', { name: 'Inspector panel' })).toBeVisible();
}

async function openPianoRollOnNewClip(page: Page): Promise<void> {
    await addMidiTrack(page);
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const row = trackList.getByRole('row').last();
    await row.click();
    const rowBox = await row.boundingBox();
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    if (rowBox === null || canvasBox === null) {
        throw new Error('track lane has no bounding box');
    }
    const y = Math.min(Math.max(rowBox.y - canvasBox.y + rowBox.height / 2, 8), canvasBox.height - 8);
    await canvas.click({ button: 'right', position: { x: 300, y } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
}

test.describe('Cross-feature workflow — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('play → mute track → open piano roll → draw note → undo → stop', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        const playhead = page.getByTestId('transport-playhead');
        await expect(play).toHaveAttribute('aria-label', 'Play');

        await play.click();
        await expect(playhead).not.toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await expect(play).toHaveAttribute('aria-label', 'Pause');

        const mute = page.locator('[data-testid^="track-mute-"]').first();
        await expect(mute).toBeVisible();
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await expect(play).toHaveAttribute('aria-label', 'Play');

        await openPianoRollOnNewClip(page);
        const noteCount = page.getByTestId('selected-clip-note-count');
        await expect(noteCount).toHaveText('0 notes');

        const paint = page.getByRole('button', { name: 'Toggle paint mode' });
        await expect(paint).toBeVisible();
        if ((await paint.getAttribute('aria-pressed')) !== 'true') {
            await paint.click();
        }
        await expect(paint).toHaveAttribute('aria-pressed', 'true');
        await page.getByLabel('Piano roll editor').click({ position: { x: 200, y: 130 } });
        await expect(noteCount).toHaveText('1 note');

        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(noteCount).toHaveText('0 notes');

        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');
    });

    test('add track → add device → bypass → open export → cancel', async ({ page }) => {
        await addMidiTrack(page);
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').last().click();
        await openInspector(page);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
        const bypass = inspector.locator('[data-testid^="device-bypass-"]').first();
        await expect(bypass).toBeVisible();
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');
        await bypass.click();
        await expect(bypass).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press(`${MOD}+Shift+E`);
        const bakery = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        await expect(bakery).toBeVisible();
        await page.getByTestId('export-cancel').click();
        await expect(bakery).toBeHidden();
    });

    test('command palette → search → Escape → open preferences', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const palette = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(palette).toBeVisible();
        await palette.fill('track');
        await expect(page.getByRole('option').filter({ hasText: /track/i }).first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();

        await page.getByRole('button', { name: 'Open Preferences' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'General', exact: true })).toBeVisible();
    });

    test('solo mode cycle → BPM increment → metronome → play', async ({ page }) => {
        const sip = page.getByTestId('solo-mode-sip');
        const afl = page.getByTestId('solo-mode-afl');
        await expect(sip).toHaveAttribute('aria-checked', 'true');
        await afl.click();
        await expect(afl).toHaveAttribute('aria-checked', 'true');
        await sip.click();
        await expect(sip).toHaveAttribute('aria-checked', 'true');

        const bpm = page.getByTestId('transport-tempo-bpm').getByRole('spinbutton');
        const before = Number(await bpm.getAttribute('aria-valuenow'));
        await bpm.focus();
        await page.keyboard.press('ArrowUp');
        await expect(bpm).toHaveAttribute('aria-valuenow', String(before + 1));

        const metronome = page.getByTestId('transport-metronome');
        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        const play = page.getByTestId('transport-play');
        const playhead = page.getByTestId('transport-playhead');
        await play.click();
        await expect(playhead).not.toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await expect(play).toHaveAttribute('aria-label', 'Pause');
        await page.getByTestId('transport-stop').click();
        await expect(play).toHaveAttribute('aria-label', 'Play');

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('dual view → scene launch → close dual view → open mixer', async ({ page }) => {
        const dualView = page.getByRole('button', { name: 'Toggle Session + Arrangement View' });
        await dualView.click();
        await expect(dualView).toHaveAttribute('aria-pressed', 'true');
        const scene1 = page.getByRole('button', { name: 'Launch scene 1' });
        await expect(scene1).toBeVisible();
        await scene1.click();

        await dualView.click();
        await expect(dualView).toHaveAttribute('aria-pressed', 'false');
        await expect(scene1).toBeHidden();

        await openBottomTab(page, 'Mixer');
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();
        await expect(page.locator('[data-testid^="channel-mute-"]').first()).toBeVisible();
    });
});
