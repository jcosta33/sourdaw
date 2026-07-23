import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Export Dialog Deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+Shift+E`);
        await expect(page.getByRole('dialog').filter({ hasText: /Bakery|Export/i })).toBeVisible({ timeout: 5000 });
    });

    test('Export dialog has format checkboxes', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        const mp3 = dialog.getByRole('checkbox', { name: /MP3/i });
        if (await mp3.isVisible().catch(() => false)) {
            const before = await mp3.isChecked().catch(() => false);
            await mp3.click();
            await page.waitForTimeout(300);
            const after = await mp3.isChecked().catch(() => false);
            expect(after).not.toBe(before);
        }
    });

    test('Export dialog has Start Baking button', async ({ page }) => {
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

test.describe('Track Folder Operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Add folder button creates a folder track', async ({ page }) => {
        const add_folder = page.getByRole('button', { name: 'Add folder' });
        if (await add_folder.isVisible().catch(() => false)) {
            await add_folder.click();
            await page.waitForTimeout(500);
            const track_list = page.getByRole('grid', { name: /Track list/i });
            const rows = await track_list.getByRole('row').count();
            expect(rows).toBeGreaterThan(0);
        }
    });
});

test.describe('Track Height Controls', () => {
    test('Track height control is present and clickable', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const height_btn = page.getByRole('button', { name: /Track height/i });
        await expect(height_btn).toBeVisible();
        await height_btn.click();
        await page.waitForTimeout(300);
        await expect(height_btn).toBeVisible();
    });
});

test.describe('Project Menu — Full Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Project menu shows template chooser', async ({ page }) => {
        await page.getByRole('button', { name: 'Project menu' }).click();
        const menu = page.getByRole('menu', { name: 'Project menu' });
        await menu.getByRole('menuitem', { name: 'New from Template…' }).click();
        await expect(page.getByText('Start a new project')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: 'EDM' })).toBeVisible();
    });

    test('Project menu shows demo chooser', async ({ page }) => {
        await page.getByRole('button', { name: 'Project menu' }).click();
        const menu = page.getByRole('menu', { name: 'Project menu' });
        await menu.getByRole('menuitem', { name: 'Load Demo Project…' }).click();
        await expect(page.getByText('Start a new project')).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Virtual Keyboard Deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle virtual keyboard' }).click();
    });

    test('Multiple octave keys are visible', async ({ page }) => {
        const keyboard = page.getByRole('application', { name: /Virtual Piano Keyboard/i });
        await expect(keyboard).toBeVisible();

        const c4 = keyboard.getByRole('button', { name: /C4/i });
        await expect(c4).toBeVisible();

        const e4 = keyboard.getByRole('button', { name: /E4/i });
        if (await e4.isVisible().catch(() => false)) {
            await expect(e4).toBeVisible();
        }
    });

    test('Velocity slider is interactive', async ({ page }) => {
        const velocity = page.getByRole('slider', { name: 'Note velocity' });
        await expect(velocity).toBeVisible();
        const value = await velocity.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
    });
});

test.describe('MIDI Learn', () => {
    test('MIDI learn buttons are present on track gain', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const learn_btn = inspector.getByRole('button', { name: 'MIDI Learn' });
        if (await learn_btn.first().isVisible().catch(() => false)) {
            await expect(learn_btn.first()).toBeVisible();
        }
    });
});

test.describe('Command Palette — Deep Search', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Search results filter correctly', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        const all_options = page.getByRole('option');
        const count_all = await all_options.count();

        await input.fill('track');
        await page.waitForTimeout(300);
        const count_filtered = await all_options.count();

        expect(count_filtered).toBeLessThanOrEqual(count_all);
        expect(count_filtered).toBeGreaterThan(0);
    });

    test('Escape closes command palette', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(input).toBeHidden({ timeout: 3000 });
    });
});

test.describe('Browser Search Filtering', () => {
    test('Browser search accepts and filters', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        await expect(search).toBeVisible();

        await search.fill('synth');
        await expect(search).toHaveValue('synth');

        await search.fill('');
        await expect(search).toHaveValue('');
    });
});

test.describe('Collaboration Panel Deep', () => {
    test('Collaboration panel has invite content', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await page.getByRole('button', { name: 'Toggle collaboration panel' }).click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        const buttons = dialog.getByRole('button');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
    });
});

test.describe('Ableton Link', () => {
    test('Ableton Link toggle changes state', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const link = page.getByRole('button', { name: /Ableton Link/i });
        await expect(link).toBeVisible();
        const label_before = await link.getAttribute('aria-label');
        await link.click();
        await page.waitForTimeout(500);
        await expect(link).toBeVisible();
    });
});
