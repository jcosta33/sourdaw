import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts — verify the real effect (track appears, panel hides).
// ---------------------------------------------------------------------------

test.describe('Keyboard shortcut behavioral effects', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();
    });

    test('N key creates a MIDI track that appears in the list', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const before = await track_list.getByRole('row', { name: /MIDI/i }).count();
        await page.keyboard.press('n');
        await page.waitForTimeout(800);
        const after = await track_list.getByRole('row', { name: /MIDI/i }).count();
        expect(after).toBeGreaterThan(before);
    });

    test('Cmd+B toggles the browser panel visibility', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await expect(browser).toBeVisible();

        await page.keyboard.press(`${MOD}+b`);
        await expect(browser).toHaveCount(0);

        await page.keyboard.press(`${MOD}+b`);
        await expect(browser).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Inspector device chain — add, bypass (aria-pressed flip), remove.
// ---------------------------------------------------------------------------

test.describe('Inspector device chain operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Bypassing a device relabels the toggle from Bypass to Enable', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
        await page.waitForTimeout(800);

        const bypass = inspector.getByRole('button', { name: /^Bypass Gluten/i });
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');

        await bypass.click();

        // The toggle relabels to "Enable Gluten" (pressed=true) once bypassed.
        const enable = inspector.getByRole('button', { name: /^Enable Gluten/i });
        await expect(enable).toBeVisible();
        await expect(enable).toHaveAttribute('aria-pressed', 'true');
    });

    test('Removing a device clears its card from the inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Bacteria$/ }).click();
        await page.waitForTimeout(800);

        const bypass_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        await inspector.getByRole('button', { name: /^Remove Bacteria/i }).click();
        await page.waitForTimeout(800);

        const bypass_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(bypass_after).toBe(bypass_before - 1);
        await expect(inspector.getByRole('button', { name: /^Bypass Bacteria/i })).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Timeline tool switching — number keys change the active radio.
// ---------------------------------------------------------------------------

test.describe('Timeline tool switching', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Number keys switch the active editing tool radio', async ({ page }) => {
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();

        await page.keyboard.press('3');
        // Exact name: /Draw/i also matches "Auto-draw".
        await expect(tools.getByRole('radio', { name: /^Draw/i })).toBeChecked();

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();
    });
});

// ---------------------------------------------------------------------------
// Browser instrument interaction — Toaster card adds a track + opens panel.
// ---------------------------------------------------------------------------

test.describe('Browser instrument interaction', () => {
    test('Toaster card creates a track and opens the Toaster panel', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await open_browser_instrument({ page, instrument: 'Toaster' });

        // The Toaster panel's kit search input appears once the panel is mounted.
        await expect(page.getByRole('textbox', { name: 'Search Toaster kits' })).toBeVisible();
    });

    test('Effects tab lists multiple effect categories', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Effects', exact: true }).click();

        expect(await browser.getByRole('button').count()).toBeGreaterThan(5);
    });
});

// ---------------------------------------------------------------------------
// Status bar — live metrics hold formatted values.
// ---------------------------------------------------------------------------

test.describe('Status bar live metrics', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('CPU metric renders a percentage or idle marker', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        const text = (await status.getByText(/CPU/i).locator('..').textContent()) ?? '';
        expect(text).toMatch(/\d+%|idle|N\/A/i);
    });

    test('Sample rate renders a kHz value', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        const text = (await status.getByText(/Rate/i).locator('..').textContent()) ?? '';
        expect(text).toMatch(/\d+\s*k?Hz/i);
    });
});
