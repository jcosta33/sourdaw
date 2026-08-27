import { expect, test } from '@playwright/test';

import { launch_from_template, launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Instrument panels — opening via the Browser Instruments tab exposes their
// panel-internal search inputs and macro controls.
// ---------------------------------------------------------------------------

test.describe('Instrument panels via Browser', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Fermenter card creates a track and opens the panel with the Macro combobox', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Fermenter' });

        // The Macro rig combobox is always visible in the Fermenter panel.
        await expect(page.getByRole('combobox', { name: 'Macro' })).toBeVisible();
    });

    test('Toaster card opens the panel with the kit search input', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Toaster' });

        await expect(page.getByRole('textbox', { name: 'Search Toaster kits' })).toBeVisible();
    });

    test('Levain card creates a Levain track in the track list', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Levain' });

        // The card creates a Levain instrument track (real state mutation).
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list.getByRole('row', { name: /Levain/i }).first()).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Session view — empty state when no tracks; scene buttons when tracks exist.
// ---------------------------------------------------------------------------

test.describe('Session view', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-session').click();
    });

    test('Session view exposes scene-launch buttons (master column always present)', async ({ page }) => {
        // A fresh project has a master track, so the session grid always renders scene buttons.
        await expect(page.getByRole('button', { name: /Launch scene 1/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /Launch scene 8/i })).toBeVisible();
    });

    test('Adding a track adds a session column for that track', async ({ page }) => {
        await add_track(page, 'MIDI');
        // The new track's disabled empty-slot buttons prove its session column rendered.
        await expect(page.getByRole('button', { name: 'MIDI scene 1 - empty' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Adjustment layers — Add opens a menu; creating a layer grows the strip.
// ---------------------------------------------------------------------------

test.describe('Adjustment layers', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Add adjustment layer opens an effect-type menu and creating one adds a row', async ({ page }) => {
        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        const add_btn = strip.getByRole('button', { name: 'Add adjustment layer' });

        await add_btn.click();
        // The effect-type picker is a floating surface (not role=menu); click by text.
        const eq_item = page.getByText('Eq', { exact: true });
        await expect(eq_item).toBeVisible();

        await eq_item.click();
        await page.waitForTimeout(500);

        // A layer row appears (named "Eq Layer").
        await expect(strip.getByText(/Eq Layer/i)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Tempo map — adding a change grows the list (regression guard).
// ---------------------------------------------------------------------------

test.describe('Tempo map editor', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Adding a tempo change replaces the empty state with a change row', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle tempo map' }).click();
        const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('No tempo changes')).toBeVisible();

        await dialog.getByRole('spinbutton', { name: 'New tempo change beat' }).fill('8');
        await dialog.getByRole('spinbutton', { name: 'New tempo change BPM' }).fill('140');
        await dialog.getByRole('button', { name: 'Add tempo change' }).click();

        await expect(dialog.getByText('No tempo changes')).toHaveCount(0);
        await expect(dialog.getByText(/Beat 8/)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Status bar — records the last action with its handler-described label.
// ---------------------------------------------------------------------------

test.describe('Status bar last-action text', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Adding a MIDI track writes "Last: Add midi track" to the status bar', async ({ page }) => {
        await add_track(page, 'MIDI');
        await page.waitForTimeout(500);

        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status.getByText(/Last:/i)).toBeVisible();
        await expect(status.getByText(/Add midi track/i)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Browser tab switching — each tab swaps the rendered content heading.
// ---------------------------------------------------------------------------

test.describe('Browser tab switching', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Switching tabs updates the browser route title', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });

        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        await expect(browser.getByText(/Effects/i).first()).toBeVisible();

        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        await expect(browser.getByText(/Project/i).first()).toBeVisible();
    });
});
