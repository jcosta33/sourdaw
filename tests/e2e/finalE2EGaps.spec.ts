import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Export dialog — Start Baking button + Escape close.
// ---------------------------------------------------------------------------

test.describe('Export dialog deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+Shift+E`);
        await expect(page.getByRole('dialog').filter({ hasText: /Bakery|Export/i })).toBeVisible({ timeout: 5000 });
    });

    test('Export dialog exposes a Start Baking action button', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        await expect(dialog.getByRole('button', { name: /Start Baking|Export|Bake/i })).toBeVisible();
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });
});

// ---------------------------------------------------------------------------
// Track folder + height — real state mutations.
// ---------------------------------------------------------------------------

test.describe('Track operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Add folder creates a folder track in the list', async ({ page }) => {
        // Seed a track so the grid renders (empty projects show no grid rows).
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const rows_before = await track_list.getByRole('row').count();

        await page.getByRole('button', { name: 'Add folder' }).click();
        await page.waitForTimeout(500);

        const rows_after = await track_list.getByRole('row').count();
        expect(rows_after).toBeGreaterThan(rows_before);
    });

    test('Track height button is present after adding a track', async ({ page }) => {
        await add_track(page, 'MIDI');
        await expect(page.getByRole('button', { name: /Track height/i })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Project menu — template + demo choosers navigate.
// ---------------------------------------------------------------------------

test.describe('Project menu navigation', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('New from Template opens the template chooser', async ({ page }) => {
        await page.getByRole('button', { name: 'Project menu' }).click();
        await page.getByRole('menu', { name: 'Project menu' }).getByRole('menuitem', { name: 'New from Template…' }).click();
        await expect(page.getByText('Start a new project')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: 'EDM' })).toBeVisible();
    });

    test('Load Demo Project opens the demo chooser', async ({ page }) => {
        await page.getByRole('button', { name: 'Project menu' }).click();
        await page.getByRole('menu', { name: 'Project menu' }).getByRole('menuitem', { name: 'Load Demo Project…' }).click();
        await expect(page.getByText('Start a new project')).toBeVisible({ timeout: 5000 });
    });
});

// ---------------------------------------------------------------------------
// Virtual keyboard — keys + velocity slider hold values.
// ---------------------------------------------------------------------------

test.describe('Virtual keyboard deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle virtual keyboard' }).click();
    });

    test('Keyboard exposes named keys and a velocity slider with a value', async ({ page }) => {
        const keyboard = page.getByRole('application', { name: /Virtual Piano Keyboard/i });
        await expect(keyboard).toBeVisible();
        await expect(keyboard.getByRole('button', { name: /C4/i })).toBeVisible();

        const velocity = page.getByRole('slider', { name: 'Note velocity' });
        await expect(velocity).toBeVisible();
        const value = await velocity.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Command palette — search filters, Escape closes.
// ---------------------------------------------------------------------------

test.describe('Command palette deep search', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Typing "track" filters to a non-empty subset', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        await input.fill('track');
        await page.waitForTimeout(300);
        expect(await page.getByRole('option').count()).toBeGreaterThan(0);
    });

    test('Escape closes the palette', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(input).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Collaboration panel — opens with content.
// ---------------------------------------------------------------------------

test.describe('Collaboration panel deep', () => {
    test('Toggling opens the collaboration dialog with invite content', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await page.getByRole('button', { name: 'Toggle collaboration panel' }).click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        expect(await dialog.getByRole('button').count()).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Browser search filtering.
// ---------------------------------------------------------------------------

test.describe('Browser search filtering', () => {
    test('Browser search accepts and clears text', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        await search.fill('synth');
        await expect(search).toHaveValue('synth');
        await search.fill('');
        await expect(search).toHaveValue('');
    });
});
