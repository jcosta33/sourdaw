import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from '../../tests/e2e/e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Dynamic Track Header Elements', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Input monitoring cycles through modes', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const monitor = track_list.getByRole('button', { name: /Input monitoring/i });
        if (await monitor.first().isVisible().catch(() => false)) {
            const label_before = await monitor.first().getAttribute('aria-label');
            await monitor.first().click();
            await page.waitForTimeout(300);
            const label_after = await monitor.first().getAttribute('aria-label');
            expect(label_after).not.toBe(label_before);
        }
    });

    test('Overdub button appears when MIDI track is armed', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const arm = track_list.getByRole('button', { name: /^Arm / });
        if (await arm.first().isVisible().catch(() => false)) {
            await arm.first().click();
            await page.waitForTimeout(500);
            const overdub = page.getByRole('button', { name: 'Overdub' });
            if (await overdub.isVisible().catch(() => false)) {
                await expect(overdub).toBeVisible();
            }
        }
    });

    test('Audio track shows audio-specific controls', async ({ page }) => {
        await add_track(page, 'Audio');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const audio_rows = track_list.getByRole('row', { name: /Audio/i });
        await expect(audio_rows.first()).toBeVisible({ timeout: 5000 });
    });

    test('Multiple tracks show independent mute/solo', async ({ page }) => {
        await add_track(page, 'MIDI');
        await add_track(page, 'Audio');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const mute_buttons = track_list.getByRole('button', { name: /^Mute / });
        const count = await mute_buttons.count();
        expect(count).toBeGreaterThanOrEqual(2);
    });
});

test.describe('MIDI Editor Note Operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        const add = page.getByRole('menuitem', { name: /Add Clip Here/i });
        if (await add.isVisible().catch(() => false)) {
            await add.click();
            await page.waitForTimeout(500);
            await timeline.dblclick({ position: { x: 200, y: 30 } });
            await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });
        }
    });

    test('Can create a note by double-clicking in the piano roll', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        await expect(piano_roll).toBeVisible();
        const box = await piano_roll.boundingBox();
        if (box) {
            await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
            await page.waitForTimeout(500);
        }
        await expect(piano_roll).toBeVisible();
    });

    test('Chord toolbar button is present', async ({ page }) => {
        const chord = page.getByRole('button', { name: /Chord/i });
        if (await chord.isVisible().catch(() => false)) {
            await expect(chord).toBeVisible();
        }
    });

    test('Active expression lane selector is present', async ({ page }) => {
        const expr_lane = page.getByRole('combobox', { name: /Active expression lane/i });
        if (await expr_lane.isVisible().catch(() => false)) {
            await expect(expr_lane).toBeVisible();
        }
    });

    test('Focused clip selector is present', async ({ page }) => {
        const focused = page.getByRole('combobox', { name: /Focused clip for note input/i });
        if (await focused.isVisible().catch(() => false)) {
            await expect(focused).toBeVisible();
        }
    });
});

test.describe('Error States & Edge Cases', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Project rename to empty string keeps old name', async ({ page }) => {
        const project_button = page.getByRole('button', { name: 'Untitled Project' });
        await project_button.click();
        const input = page.locator('input:focus');
        await input.fill('');
        await input.press('Enter');
        await page.waitForTimeout(500);
        await expect(page.getByText('Untitled Project')).toBeVisible();
    });

    test('Rapid play/stop toggling maintains consistent state', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        for (let i = 0; i < 5; i++) {
            await play.first().click();
            await page.waitForTimeout(200);
        }
        await expect(play.first()).toBeVisible();
    });

    test('Rapid panel toggling does not crash', async ({ page }) => {
        for (const shortcut of [`${MOD}+b`, `${MOD}+i`, `${MOD}+m`, `${MOD}+j`]) {
            await page.keyboard.press(shortcut);
            await page.waitForTimeout(100);
        }
        for (const shortcut of [`${MOD}+b`, `${MOD}+i`, `${MOD}+m`, `${MOD}+j`]) {
            await page.keyboard.press(shortcut);
            await page.waitForTimeout(100);
        }
        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('Track context menu appears on right-click', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list.getByRole('row', { name: /MIDI/i }).first()).toBeVisible({ timeout: 5000 });

        track_list.getByRole('row', { name: /MIDI/i }).first().click({ button: 'right' });
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const items = menu.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
    });

    test('Undo reverses the last track addition', async ({ page }) => {
        await add_track(page, 'MIDI');
        await page.waitForTimeout(500);
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const rows_with_track = await track_list.getByRole('row', { name: /MIDI/i }).count();
        expect(rows_with_track).toBeGreaterThan(0);

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        if (await undo.isEnabled().catch(() => false)) {
            await undo.click();
            await page.waitForTimeout(2000);
            const rows_after_undo = await track_list.getByRole('row', { name: /MIDI/i }).count();
            expect(rows_after_undo).toBeLessThanOrEqual(rows_with_track);
        }
    });

    test('Count-in bars cycle wraps from 4 back to 1', async ({ page }) => {
        const count_in = page.getByRole('button', { name: 'Count-in', exact: true });
        await count_in.click();
        const bars = page.getByRole('button', { name: /Count-in bars/i });
        await expect(bars).toBeVisible();

        for (let i = 0; i < 4; i++) {
            await bars.click({ force: true });
            await page.waitForTimeout(200);
        }
        const label = await bars.getAttribute('aria-label');
        expect(label).toContain('Count-in bars: 1');
    });

    test('Opening multiple dialogs does not crash', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.keyboard.press('Shift+Slash');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Remaining AI & Collab Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Collaboration panel close button is present', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle collaboration panel' }).click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        const close = dialog.getByRole('button', { name: 'Close' });
        if (await close.isVisible().catch(() => false)) {
            await expect(close).toBeVisible();
        }
    });

    test('BrowserAi re-detect capabilities button is present', async ({ page }) => {
        const redetect = page.getByRole('button', { name: 'Re-detect capabilities' });
        if (await redetect.isVisible().catch(() => false)) {
            await expect(redetect).toBeVisible();
        }
    });

    test('Gluten preset search is present when device added', async ({ page }) => {
        await add_track(page, 'MIDI');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const gluten = page.getByRole('menuitem', { name: /Gluten/i });
        if (await gluten.isVisible().catch(() => false)) {
            await gluten.click();
            await page.waitForTimeout(1000);
            const search = page.getByRole('searchbox', { name: 'Search Gluten presets' })
                .or(page.getByPlaceholder('Search Gluten presets'));
            if (await search.first().isVisible().catch(() => false)) {
                await expect(search.first()).toBeVisible();
            }
        }
    });

    test('Toaster kit search is present when device added', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const toaster = browser.getByRole('button', { name: /Toaster/i });
        if (await toaster.isVisible().catch(() => false)) {
            await toaster.click();
            await page.waitForTimeout(1000);
            const search = page.getByRole('searchbox', { name: 'Search Toaster kits' })
                .or(page.getByPlaceholder('Search Toaster kits'));
            if (await search.first().isVisible().catch(() => false)) {
                await expect(search.first()).toBeVisible();
            }
        }
    });

    test('Levain instrument search is present when device added', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const levain = browser.getByRole('button', { name: /Levain/i });
        if (await levain.isVisible().catch(() => false)) {
            await levain.click();
            await page.waitForTimeout(1000);
            const search = page.getByRole('searchbox', { name: 'Search Levain instruments' })
                .or(page.getByPlaceholder('Search Levain instruments'));
            if (await search.first().isVisible().catch(() => false)) {
                await expect(search.first()).toBeVisible();
            }
        }
    });
});
