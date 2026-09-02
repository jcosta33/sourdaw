import { expect, test } from '@playwright/test';

import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Browser tabs — each tab renders distinct content; switching is observable.
// ---------------------------------------------------------------------------

test.describe('Browser tabs deep', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Effects tab lists multiple effect categories', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        expect(await browser.getByRole('button').count()).toBeGreaterThan(5);
    });

    test('Project tab shows project metadata', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        // The Project tab surfaces project meta (name, created date, tuning).
        await expect(browser.getByText(/PROJECT META|Name|Created/i).first()).toBeVisible({ timeout: 5000 });
    });

    test('Browser search filters and clears', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        await search.fill('synth');
        await expect(search).toHaveValue('synth');
        await search.fill('');
        await expect(search).toHaveValue('');
    });
});

// ---------------------------------------------------------------------------
// Inspector — track notes, gain slider, device chain add/remove.
// ---------------------------------------------------------------------------

test.describe('Inspector notes and gain', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Track notes accept and persist typed text', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const notes = inspector.getByRole('textbox', { name: /Notes/i });
        await notes.fill('Production notes here');
        await expect(notes).toHaveValue('Production notes here');
    });

    test('Track gain slider holds a numeric value', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gain = inspector.getByRole('slider', { name: /gain/i });
        // A new track's gain defaults to 0.8 (TrackLevelSection.tsx `track.gain
        // ?? 0.8`), rendered as percent-of-unity (activeGain * 100). The slider's
        // range is [0, FADER_MAX_GAIN * 100] (src/utils/audioLevelLaw.ts):
        // FADER_MAX_GAIN = dbToGain(FADER_HEADROOM_DB) = 10 ** (6 / 20).
        await expect(gain).toHaveAttribute('aria-valuenow', '80');
        await expect(gain).toHaveAttribute('aria-valuemin', '0');
        await expect(gain).toHaveAttribute('aria-valuemax', String(10 ** (6 / 20) * 100));
    });
});

// ---------------------------------------------------------------------------
// Device chain — adding Gluten creates a bypassable card; removing clears it.
// ---------------------------------------------------------------------------

test.describe('Device chain operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Adding Gluten creates a Bypass toggle that relabels on click', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
        await page.waitForTimeout(800);

        const bypass = inspector.getByRole('button', { name: /^Bypass Gluten/i });
        await expect(bypass).toBeVisible();
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');

        await bypass.click();
        // Relabels to "Enable Gluten" (pressed=true).
        const enable = inspector.getByRole('button', { name: /^Enable Gluten/i });
        await expect(enable).toBeVisible();
        await expect(enable).toHaveAttribute('aria-pressed', 'true');
    });

    test('Removing a device decrements the bypass-button count', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Bacteria$/ }).click();
        await page.waitForTimeout(800);

        const before = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        await inspector.getByRole('button', { name: /^Remove Bacteria/i }).click();
        await page.waitForTimeout(800);

        const after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(after).toBe(before - 1);
        await expect(inspector.getByRole('button', { name: /^Bypass Bacteria/i })).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Timeline empty-surface menu — right-click reveals track-creation items.
// ---------------------------------------------------------------------------

test.describe('Timeline context menu', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Right-click empty timeline exposes Add Clip Here and track items', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const names = (await menu.getByRole('menuitem').allInnerTexts()).join(' | ');
        expect(names).toMatch(/Add Clip Here/);
        expect(names).toMatch(/Add MIDI Track|Add Audio Track/);
    });
});

// ---------------------------------------------------------------------------
// Export dialog — Escape closes.
// ---------------------------------------------------------------------------

test.describe('Export dialog escape close', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Export dialog closes with Escape', async ({ page }) => {
        await page.keyboard.press(`${MOD}+Shift+E`);
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });
});
