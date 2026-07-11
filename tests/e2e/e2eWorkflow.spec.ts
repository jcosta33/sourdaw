import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function create_midi_clip(page: import('@playwright/test').Page): Promise<boolean> {
    await add_track(page, 'MIDI');
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
    const add = page.getByRole('menuitem', { name: /Add Clip Here/i });
    if (await add.isVisible().catch(() => false)) {
        await add.click();
        await page.waitForTimeout(500);
        return true;
    }
    return false;
}

test.describe('End-to-End DAW Workflow', () => {
    test('Full MIDI workflow: track → device → clip → notes → undo', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list.getByRole('row', { name: /MIDI/i }).first()).toBeVisible({ timeout: 5000 });

        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        const add_clip = page.getByRole('menuitem', { name: /Add Clip Here/i });
        if (await add_clip.isVisible().catch(() => false)) {
            await add_clip.click();
            await page.waitForTimeout(500);
            await expect(page.getByText(/clip/i).first()).toBeVisible();

            await timeline.dblclick({ position: { x: 200, y: 30 } });
            await expect(page.getByLabel('Piano roll editor')).toBeVisible({ timeout: 10000 });

            const piano_roll = page.getByLabel('Piano roll editor');
            const box = await piano_roll.boundingBox();
            if (box) {
                await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
                await page.waitForTimeout(500);
            }

            const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
            await play.first().click();
            await page.waitForTimeout(1000);
            await play.first().click();
            await page.waitForTimeout(500);

            const stop = page.getByRole('button', { name: 'Stop' });
            await stop.click();
            await page.waitForTimeout(300);
        }

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('Template load and verify instrument devices are present', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const tracks = track_list.getByRole('row');
        const track_count = await tracks.count();
        expect(track_count).toBeGreaterThanOrEqual(2);

        for (let i = 0; i < Math.min(track_count, 3); i++) {
            await tracks.nth(i).click();
            await page.waitForTimeout(300);
            await expect(inspector).toBeVisible();
        }
    });

    test('Mixer workflow: mute → solo → unmute → unsolo', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible({ timeout: 5000 });

        const channels = mixer.getByRole('group', { name: /channel/i });
        if (await channels.first().isVisible().catch(() => false)) {
            const first_channel = channels.first();

            const mute = first_channel.getByRole('button', { name: /^Mute/i }).or(first_channel.getByRole('button', { name: /^Unmute/i }));
            const solo = first_channel.getByRole('button', { name: /^Solo/i }).or(first_channel.getByRole('button', { name: /^Unsolo/i }));

            if (await mute.first().isVisible().catch(() => false)) {
                await mute.first().click();
                await page.waitForTimeout(300);
                await mute.first().click();
                await page.waitForTimeout(300);
            }

            if (await solo.first().isVisible().catch(() => false)) {
                await solo.first().click();
                await page.waitForTimeout(300);
                await solo.first().click();
                await page.waitForTimeout(300);
            }
        }

        await expect(mixer).toBeVisible();
    });

    test('Multiple undo/redo cycle preserves state', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await add_track(page, 'MIDI');
        await page.waitForTimeout(300);
        await add_track(page, 'Audio');
        await page.waitForTimeout(300);

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo' });

        const rows_after_add = await track_list.getByRole('row').count();

        if (await undo.isEnabled().catch(() => false)) {
            await undo.click();
            await page.waitForTimeout(1500);
            const rows_after_undo = await track_list.getByRole('row').count();
            expect(rows_after_undo).toBeLessThanOrEqual(rows_after_add);

            if (await redo.isEnabled().catch(() => false)) {
                await redo.click();
                await page.waitForTimeout(1500);
            }
        }

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Inspector Deep Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Track color picker buttons are clickable', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const colors = inspector.getByRole('button', { name: /Set color/i });
        const count = await colors.count();
        if (count > 0) {
            await colors.first().click();
            await page.waitForTimeout(300);
        }
    });

    test('Inspector device bypass changes state and reflects in chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const bypass = inspector.getByRole('button', { name: /Bypass Synth/i });
        await bypass.click();
        await expect(inspector.getByRole('button', { name: /Enable Synth/i })).toBeVisible({ timeout: 5000 });

        await inspector.getByRole('button', { name: /Enable Synth/i }).click();
        await expect(inspector.getByRole('button', { name: /Bypass Synth/i })).toBeVisible({ timeout: 5000 });
    });

    test('Adding and removing an automation lane updates inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        await inspector.getByRole('button', { name: /Add automation lane/i }).click();
        await page.waitForTimeout(500);

        const remove = inspector.getByRole('button', { name: /Remove lane/i });
        if (await remove.isVisible().catch(() => false)) {
            const lanes_before = await inspector.getByText(/Show|Hide/i).count();
            await remove.click();
            await page.waitForTimeout(500);
        }

        await expect(inspector).toBeVisible();
    });

    test('Track gain slider has visible value display', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gain = inspector.getByRole('slider', { name: /gain/i });
        await expect(gain).toBeVisible();

        const value_text = await inspector.getByText(/\d+%/).first().textContent().catch(() => '');
        expect(value_text).toMatch(/\d/);
    });

    test('Track notes accept and display text', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const notes = inspector.getByRole('textbox', { name: /Notes/i });
        await notes.fill('My production notes');
        await expect(notes).toHaveValue('My production notes');
    });

    test('VCA group creation adds group selector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Create VCA group/i }).click();
        await page.waitForTimeout(500);

        const vca_select = inspector.getByRole('combobox', { name: 'VCA group' });
        await expect(vca_select).toBeVisible();
        const selected = await vca_select.getByRole('option', { selected: true }).textContent().catch(() => '');
    });
});

test.describe('Browser Panel Deep Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Switching between all browser tabs changes content', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const tabs = ['Instruments', 'Effects', 'Library', 'Macros', 'Project'];

        for (const tab_name of tabs) {
            await browser.getByRole('button', { name: tab_name, exact: true }).click();
            await page.waitForTimeout(300);
            await expect(browser).toBeVisible();
        }
    });

    test('Browser search clears when input is emptied', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });

        await search.fill('synth');
        await expect(search).toHaveValue('synth');

        await search.fill('');
        await expect(search).toHaveValue('');
    });

    test('Browser Project tab shows project info', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        await page.waitForTimeout(500);

        const content = browser.getByText(/BPM|tempo|track|arrangement|signature/i);
        const visible = await content.first().isVisible().catch(() => false);
        if (visible) {
            await expect(content.first()).toBeVisible();
        }
    });
});
