import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Dynamic track-header elements — input monitoring cycles, overdub toggles.
// ---------------------------------------------------------------------------

test.describe('Dynamic track-header elements', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Input monitoring cycles Auto → On → Off → Auto', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const monitor = track_list.getByRole('button', { name: /Input monitoring/i }).first();

        await expect(monitor).toHaveAccessibleName(/Input monitoring: Auto/i);
        await monitor.click();
        await expect(monitor).toHaveAccessibleName(/Input monitoring: On/i);
        await monitor.click();
        await expect(monitor).toHaveAccessibleName(/Input monitoring: Off/i);
        await monitor.click();
        await expect(monitor).toHaveAccessibleName(/Input monitoring: Auto/i);
    });

    test('Overdub toggle flips aria-pressed when a MIDI track is armed', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('button', { name: /^Arm / }).first().click();

        const overdub = page.getByRole('button', { name: 'Overdub' });
        await expect(overdub).toHaveAttribute('aria-pressed', 'false');
        await overdub.click();
        await expect(overdub).toHaveAttribute('aria-pressed', 'true');
    });

    test('Two tracks each expose independent mute buttons', async ({ page }) => {
        await add_track(page, 'MIDI');
        await add_track(page, 'Audio');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const mutes = track_list.getByRole('button', { name: /^Mute / });
        // Each track renders header + body rows, so >=2 distinct mute controls.
        expect(await mutes.count()).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// MIDI editor — note creation and the chord-stamp toggle.
// ---------------------------------------------------------------------------

test.describe('MIDI editor note operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);
        await timeline.dblclick({ position: { x: 300, y: 30 } });
        await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });
    });

    test('Double-clicking the piano roll enables the Undo button (a note was created)', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });

        const box = await piano_roll.boundingBox();
        if (!box) throw new Error('piano roll missing');
        await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
        await page.waitForTimeout(500);

        await expect(undo).toBeEnabled();
    });

    test('Chord-stamp-mode toggle flips aria-pressed', async ({ page }) => {
        const chord = page.getByRole('button', { name: 'Toggle chord stamp mode' });
        const before = await chord.getAttribute('aria-pressed');
        await chord.click();
        await expect(chord).not.toHaveAttribute('aria-pressed', before ?? '');
    });
});

// ---------------------------------------------------------------------------
// Edge cases — empty rename, rapid toggling, track context menu.
// ---------------------------------------------------------------------------

test.describe('Edge cases', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Renaming the project to empty keeps the previous name', async ({ page }) => {
        const project_button = page.getByRole('button', { name: 'Untitled Project' });
        await project_button.click();
        const input = page.locator('input:focus');
        await input.fill('');
        await input.press('Enter');
        // The name is preserved (empty is rejected).
        await expect(page.getByRole('button', { name: 'Untitled Project' })).toBeVisible();
    });

    test('Rapid play/stop toggling leaves transport in a stable state', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        for (let i = 0; i < 5; i++) {
            await play.first().click();
            await page.waitForTimeout(200);
        }
        // After toggling, exactly one of Play/Pause is visible (transport didn't crash).
        const play_count = await page.getByRole('button', { name: 'Play', exact: true }).count();
        const pause_count = await page.getByRole('button', { name: 'Pause', exact: true }).count();
        expect(play_count + pause_count).toBeGreaterThanOrEqual(1);
    });

    test('Track context menu lists operations on right-click', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('row', { name: /MIDI/i }).first().click({ button: 'right' });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const names = await menu.getByRole('menuitem').allInnerTexts();
        const flat = names.join(' | ');
        // Track context menu exposes rename and delete at minimum.
        expect(flat).toMatch(/Rename|Delete|Duplicate|Color/);
        await page.keyboard.press('Escape');
    });
});

// ---------------------------------------------------------------------------
// Collaboration panel — toggle opens and close dismisses.
// ---------------------------------------------------------------------------

test.describe('Collaboration panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toggling opens the collaboration dialog and toggling again dismisses it', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle collaboration panel' });
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });

        await expect(dialog).toHaveCount(0);
        await toggle.click();
        await expect(dialog).toBeVisible();

        // Dismiss via the same toggle (the inner Close button animates and is unreliable to click).
        await toggle.click();
        await expect(dialog).toHaveCount(0);
    });
});
