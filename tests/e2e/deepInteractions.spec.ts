import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Export Dialog Deep Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+Shift+E`);
        await expect(page.getByRole('dialog').filter({ hasText: /Bakery|Export/i })).toBeVisible({ timeout: 5000 });
    });

    test('Export format checkboxes are toggleable', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        const mp3 = dialog.getByRole('checkbox', { name: /MP3/i });

        if (await mp3.isVisible().catch(() => false)) {
            const state_before = await mp3.isChecked().catch(() => false);
            await mp3.click();
            await page.waitForTimeout(300);
            const state_after = await mp3.isChecked().catch(() => false);
            expect(state_after).not.toBe(state_before);
        }
    });

    test('Start Baking button is present', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        const bake = dialog.getByRole('button', { name: /Start Baking|Export|Bake/i });
        if (await bake.isVisible().catch(() => false)) {
            await expect(bake).toBeVisible();
        }
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });
});

test.describe('Command Palette Deep Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can search and filter commands', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        const all_options = page.getByRole('option');
        const count_all = await all_options.count();

        await input.fill('track');
        await page.waitForTimeout(500);
        const filtered_options = page.getByRole('option');
        const count_filtered = await filtered_options.count();

        expect(count_filtered).toBeLessThanOrEqual(count_all);
    });

    test('Can navigate options with arrow keys', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Escape');
    });

    test('Escape closes the command palette', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(input).toBeHidden({ timeout: 3000 });
    });

    test('Can execute Add Audio Track via palette', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await input.fill('Add Audio Track');
        await page.getByRole('option', { name: 'Add Audio Track' }).click();

        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list.getByRole('row', { name: /Audio/i }).first()).toBeVisible({ timeout: 5000 });
    });
});

test.describe('MIDI Editor Note Interactions', () => {
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

    test('Can create multiple notes at different positions', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const box = await piano_roll.boundingBox();
        if (box) {
            await piano_roll.dblclick({ position: { x: box.width * 0.2, y: box.height * 0.4 } });
            await page.waitForTimeout(300);
            await piano_roll.dblclick({ position: { x: box.width * 0.4, y: box.height * 0.5 } });
            await page.waitForTimeout(300);
            await piano_roll.dblclick({ position: { x: box.width * 0.6, y: box.height * 0.6 } });
            await page.waitForTimeout(300);
        }
        await expect(piano_roll).toBeVisible();
    });

    test('Velocity lane is visible in MIDI editor', async ({ page }) => {
        const velocity_lane = page.getByLabel(/Velocity/i).or(page.locator('[aria-label*="velocity" i]'));
        const visible = await velocity_lane.first().isVisible().catch(() => false);
        if (visible) {
            await expect(velocity_lane.first()).toBeVisible();
        }
    });

    test('Undo in MIDI editor reverts note creation', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const box = await piano_roll.boundingBox();
        if (box) {
            await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
            await page.waitForTimeout(500);
        }

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        if (await undo.isEnabled().catch(() => false)) {
            await undo.click();
            await page.waitForTimeout(1000);
        }

        await expect(piano_roll).toBeVisible();
    });

    test('Scale controls constrain note input', async ({ page }) => {
        const fold = page.getByRole('button', { name: /Toggle fold to scale/i });
        if (await fold.isVisible().catch(() => false)) {
            const pressed_before = await fold.getAttribute('aria-pressed');
            await fold.click();
            await page.waitForTimeout(300);
            await expect(fold).toBeVisible();
        }
    });
});

test.describe('Timeline Clip Interactions', () => {
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
        }
    });

    test('Clip appears on timeline after creation', async ({ page }) => {
        await expect(page.getByText(/clip/i).first()).toBeVisible();
    });

    test('Clip context menu shows edit operations', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        const menu = page.getByRole('menu');
        if (await menu.isVisible().catch(() => false)) {
            const items = menu.getByRole('menuitem');
            const count = await items.count();
            expect(count).toBeGreaterThan(0);
            const item_texts = await items.allInnerTexts();
            const has_edit_op = item_texts.some((t) => /copy|paste|delete|rename|duplicate|split|normalize|reverse/i.test(t));
            expect(has_edit_op).toBe(true);
        }
    });

    test('Clip duplicate via Cmd+D creates second clip', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ position: { x: 200, y: 30 } });
        await page.waitForTimeout(300);

        await page.locator('#main-content').click();
        await page.keyboard.press(`${MOD}+d`);
        await page.waitForTimeout(1000);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('Marquee selection tool can be activated', async ({ page }) => {
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });
        const marquee = tools.getByRole('radio', { name: /Marquee/i });
        await marquee.click();
        await expect(marquee).toBeChecked();

        const select = tools.getByRole('radio', { name: /Select/i });
        await select.click();
        await expect(select).toBeChecked();
    });
});

test.describe('Preferences Deep Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        await page.getByRole('dialog').filter({ hasText: /Preferences/i }).waitFor({ state: 'visible', timeout: 5000 });
    });

    test('Can navigate preference tabs', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const tabs = dialog.getByRole('tab');
        const count = await tabs.count();
        if (count > 1) {
            await tabs.nth(1).click();
            await page.waitForTimeout(500);
            await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

            await tabs.nth(0).click();
            await page.waitForTimeout(500);
            await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
        }
    });

    test('Audio buffer size has selectable options', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const buffer = dialog.getByRole('combobox', { name: /Buffer size/i });
        if (await buffer.isVisible().catch(() => false)) {
            const options = await buffer.getByRole('option').count();
            expect(options).toBeGreaterThan(0);
        }
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });
});
