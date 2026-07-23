import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// End-to-end workflow — real multi-step journeys with state verification.
// ---------------------------------------------------------------------------

test.describe('End-to-end DAW workflow', () => {
    test('Full MIDI workflow: track → clip → editor → note → undo enabled', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list.getByRole('row', { name: /MIDI/i }).first()).toBeVisible({ timeout: 5000 });

        // Create a clip and open the editor.
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);
        await timeline.dblclick({ position: { x: 300, y: 30 } });
        const piano_roll = page.getByLabel('Piano roll editor');
        await expect(piano_roll).toBeVisible({ timeout: 10000 });

        // Create a note → undo becomes enabled.
        const box = await piano_roll.boundingBox();
        if (box) {
            await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
            await page.waitForTimeout(500);
        }
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    });

    test('Template load yields multiple tracks', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        expect(await track_list.getByRole('row').count()).toBeGreaterThanOrEqual(2);
    });

    test('Undo button is enabled after adding a track', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Before any action, undo is disabled (no history).
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeDisabled();

        await add_track(page, 'MIDI');
        await page.waitForTimeout(300);

        // After adding a track, undo becomes enabled (history pushed).
        await expect(undo).toBeEnabled();
    });
});

// ---------------------------------------------------------------------------
// Inspector deep — device bypass round-trip, automation lane, gain value.
// ---------------------------------------------------------------------------

test.describe('Inspector deep interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Default Synth device bypass round-trips Bypass → Enable → Bypass', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        const bypass = inspector.getByRole('button', { name: /^Bypass Synth/i });
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');
        await bypass.click();

        const enable = inspector.getByRole('button', { name: /^Enable Synth/i });
        await expect(enable).toBeVisible();
        await expect(enable).toHaveAttribute('aria-pressed', 'true');

        await enable.click();
        await expect(bypass).toBeVisible();
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');
    });

    test('Adding an automation lane creates a removable Gain lane', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        await expect(inspector.getByText('No automation lanes yet')).toBeVisible();
        await inspector.getByRole('button', { name: /Add automation lane/i }).click();
        await page.getByRole('menuitem', { name: 'Gain', exact: true }).first().click();

        const remove = inspector.getByRole('button', { name: 'Remove lane' });
        await expect(remove).toBeVisible();

        await remove.click();
        await expect(inspector.getByText('No automation lanes yet')).toBeVisible();
    });

    test('Track notes accept and display typed text', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const notes = inspector.getByRole('textbox', { name: /Notes/i });
        await notes.fill('My production notes');
        await expect(notes).toHaveValue('My production notes');
    });
});

// ---------------------------------------------------------------------------
// Browser panel — tab content swap and search.
// ---------------------------------------------------------------------------

test.describe('Browser panel deep interactions', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Switching to Project tab shows project metadata', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        await expect(browser.getByText(/PROJECT META|Name|Created/i).first()).toBeVisible({ timeout: 5000 });
    });

    test('Browser search accepts and clears text', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        await search.fill('synth');
        await expect(search).toHaveValue('synth');
        await search.fill('');
        await expect(search).toHaveValue('');
    });
});
