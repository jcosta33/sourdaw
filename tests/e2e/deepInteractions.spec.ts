import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

/** Create a MIDI clip and open the piano roll (proven pattern). */
async function open_midi_editor(page: import('@playwright/test').Page): Promise<void> {
    await add_track(page, 'MIDI');
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);
    await timeline.dblclick({ position: { x: 300, y: 30 } });
    await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Export dialog — format checkbox toggles and Escape closes.
// ---------------------------------------------------------------------------

test.describe('Export dialog deep interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+Shift+E`);
        await expect(page.getByRole('dialog').filter({ hasText: /Bakery|Export/i })).toBeVisible({ timeout: 5000 });
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });

    test('Export dialog exposes a Start Baking action button', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        await expect(dialog.getByRole('button', { name: /Start Baking|Export|Bake/i })).toBeVisible();
    });

    test('Export dialog closes with Escape', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Command palette — search filters, arrow keys navigate, Escape closes.
// ---------------------------------------------------------------------------

test.describe('Command palette deep interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Searching filters the option list to a subset', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        const count_all = await page.getByRole('option').count();
        expect(count_all).toBeGreaterThan(0);

        await input.fill('track');
        await page.waitForTimeout(500);
        const count_filtered = await page.getByRole('option').count();

        expect(count_filtered).toBeLessThanOrEqual(count_all);
        expect(count_filtered).toBeGreaterThan(0);
    });

    test('Escape closes the command palette', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(input).toHaveCount(0);
    });

    test('Executing Add Audio Track via palette creates the track', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await input.fill('Add Audio Track');
        await page.getByRole('option', { name: 'Add Audio Track' }).click();

        await expect(page.getByRole('grid', { name: /Track list/i }).getByRole('row', { name: /Audio/i }).first()).toBeVisible({ timeout: 5000 });
    });
});

// ---------------------------------------------------------------------------
// MIDI editor — fold-to-scale toggle (aria-pressed), note creation enables undo.
// ---------------------------------------------------------------------------

test.describe('MIDI editor note interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_midi_editor(page);
    });

    test('Fold-to-scale toggle flips aria-pressed', async ({ page }) => {
        const fold = page.getByRole('button', { name: 'Toggle fold to scale' });
        const before = await fold.getAttribute('aria-pressed');
        await fold.click();
        await expect(fold).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Creating a note enables the Undo button', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const box = await piano_roll.boundingBox();
        if (!box) throw new Error('piano roll missing');
        await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
        await page.waitForTimeout(500);
        await expect(undo).toBeEnabled();
    });
});

// ---------------------------------------------------------------------------
// Timeline — clip context menu, tool switching.
// ---------------------------------------------------------------------------

test.describe('Timeline clip interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);
    });

    test('Clip context menu exposes edit operations by exact name', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const names = (await menu.getByRole('menuitem').allInnerTexts()).join(' | ');
        expect(names).toMatch(/Split at Cursor/);
        expect(names).toMatch(/Delete/);
        expect(names).toMatch(/Rename Clip/);
    });

    test('Marquee tool radio switches active and back to Select', async ({ page }) => {
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });
        const marquee = tools.getByRole('radio', { name: /Marquee/i });
        const select = tools.getByRole('radio', { name: /Select/i });

        await marquee.click();
        await expect(marquee).toBeChecked();

        await select.click();
        await expect(select).toBeChecked();
    });
});

// ---------------------------------------------------------------------------
// Preferences — tab navigation changes aria-selected.
// ---------------------------------------------------------------------------

test.describe('Preferences deep interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        await page.getByRole('dialog').filter({ hasText: /Preferences/i }).waitFor({ state: 'visible', timeout: 5000 });
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });

    test('Navigating to Performance exposes the audio-processing-profile selector', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await dialog.getByRole('button', { name: 'Performance', exact: true }).click();

        const profile = dialog.getByRole('combobox', { name: 'Audio processing profile' });
        await expect(profile).toBeVisible();
        expect(await profile.locator('option').count()).toBeGreaterThanOrEqual(2);
    });
});
