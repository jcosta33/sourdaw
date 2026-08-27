import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

/**
 * Open the bottom dock and switch to a tab identified by its id suffix.
 */
async function open_dock_tab(page: import('@playwright/test').Page, tab_id: string): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
    const pressed = (await toggle.getAttribute('aria-pressed')) ?? '';
    if (!pressed.match(/true/i)) {
        await toggle.click();
    }
    await page.locator(`#bottom-dock-tab-${tab_id}`).click();
}

/** The AI change toast is a DawUtilityPanel[role=status] with Undo/Dismiss buttons. */
function ai_toast(page: import('@playwright/test').Page) {
    return page.getByRole('status').filter({ hasText: /Undo|Dismiss/ });
}

// ---------------------------------------------------------------------------
// Modulation matrix — verify real state mutations (modulator card count,
// empty-state presence, aria-expanded form toggle, name persistence).
// ---------------------------------------------------------------------------

test.describe('Modulation matrix — real state mutations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await open_dock_tab(page, 'modulation');
    });

    test('New Modulator toggles aria-expanded and reveals the form fields', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        // exact name: otherwise "Close new modulator form" matches /New Modulator/i.
        const new_btn = matrix.getByRole('button', { name: 'New Modulator', exact: true });

        // Before: collapsed, empty state visible.
        await expect(new_btn).toHaveAttribute('aria-expanded', 'false');
        await expect(matrix.getByText('No modulators')).toBeVisible();

        await new_btn.click();

        // After: expanded, form fields render.
        await expect(new_btn).toHaveAttribute('aria-expanded', 'true');
        await expect(matrix.getByRole('textbox', { name: 'Modulator name' })).toBeVisible();
        await expect(matrix.getByRole('combobox', { name: 'Modulator kind' })).toBeVisible();
        await expect(matrix.getByRole('combobox', { name: 'Modulator track scope' })).toBeVisible();
    });

    test('Modulator kind combobox exposes LFO and Step options (not Envelope)', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();

        const kind = matrix.getByRole('combobox', { name: 'Modulator kind' });
        await kind.click();
        const option_names = await page.getByRole('option').allInnerTexts();
        const trimmed = option_names.map((n) => n.trim());
        expect(trimmed).toContain('LFO');
        expect(trimmed).toContain('Step');
        expect(trimmed).not.toContain('Envelope');
    });

    test('Creating an LFO modulator removes the empty state and adds a card', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });

        // Before: no cards, empty state shown.
        await expect(matrix.getByText('No modulators')).toBeVisible();
        expect(await matrix.getByRole('checkbox', { name: /^Enabled$/i }).count()).toBe(0);

        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        // Name is retained in the persisted card.
        const name_input = matrix.getByRole('textbox', { name: 'Modulator name' });
        await name_input.fill('My LFO');
        // A track exists from beforeEach, so the Add button is enabled.
        await matrix.getByRole('button', { name: 'Add', exact: true }).click();

        // After: empty state gone, one card. The card exposes a rename box (labelled by
        // the modulator id) carrying the name we typed, plus a remove button by name.
        await expect(matrix.getByText('No modulators')).toHaveCount(0);
        const rename = matrix.getByRole('textbox', { name: /^Rename modulator/ });
        await expect(rename).toBeVisible();
        await expect(rename).toHaveValue('My LFO');
        await expect(matrix.getByLabel('Remove modulator My LFO')).toBeVisible();
        expect(await matrix.getByRole('checkbox', { name: /^Enabled$/i }).count()).toBe(1);
    });

    test('Removing a modulator decrements the card count back to the empty state', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });

        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        await matrix.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(matrix.getByLabel('Remove modulator LFO')).toBeVisible();

        await matrix.getByLabel('Remove modulator LFO').click();

        await expect(matrix.getByText('No modulators')).toBeVisible();
        expect(await matrix.getByLabel(/Remove modulator/).count()).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Setlist — add/remove/move/reorder mutate the items list verifiably.
// The list only renders when items exist; the empty state appears otherwise.
// ---------------------------------------------------------------------------

test.describe('Setlist — list mutations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_dock_tab(page, 'setlist');
    });

    test('Add setlist item creates a list, removes the empty state, names items sequentially', async ({ page }) => {
        // Before: empty state, no list.
        await expect(page.getByText('No setlist items')).toBeVisible();
        await expect(page.getByRole('list', { name: 'Setlist items' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Add setlist item' }).click();

        // After: list exists with one item named "Song 1".
        const items = page.getByRole('list', { name: 'Setlist items' });
        await expect(items).toBeVisible();
        expect(await items.getByRole('listitem').count()).toBe(1);
        await expect(items.getByText('Song 1')).toBeVisible();

        // Second add → "Song 2".
        await page.getByRole('button', { name: 'Add setlist item' }).click();
        expect(await items.getByRole('listitem').count()).toBe(2);
        await expect(items.getByText('Song 2')).toBeVisible();
    });

    test('Remove setlist item decrements count and restores empty state when last', async ({ page }) => {
        await page.getByRole('button', { name: 'Add setlist item' }).click();
        await page.getByRole('button', { name: 'Add setlist item' }).click();
        const items = page.getByRole('list', { name: 'Setlist items' });
        expect(await items.getByRole('listitem').count()).toBe(2);

        await page.getByLabel('Remove Song 1').click();

        expect(await items.getByRole('listitem').count()).toBe(1);
        await expect(items.getByText('Song 2')).toBeVisible();

        // Remove the last one → empty state returns.
        await page.getByLabel('Remove Song 2').click();
        await expect(page.getByText('No setlist items')).toBeVisible();
        await expect(items).toHaveCount(0);
    });

    test('Move down reorders items (first item swaps below second)', async ({ page }) => {
        await page.getByRole('button', { name: 'Add setlist item' }).click();
        await page.getByRole('button', { name: 'Add setlist item' }).click();
        const items = page.getByRole('list', { name: 'Setlist items' });

        // Capture the rendered name order via the listitem text (each row shows "Song N").
        const rows = items.getByRole('listitem');
        const name_of = async (i: number) => (await rows.nth(i).innerText()).match(/Song \d+/)?.[0] ?? '';
        const before_first = await name_of(0);
        const before_second = await name_of(1);

        // Move-down on the first item (buttons are opacity-0 until hover; still in the DOM).
        await items.getByRole('button', { name: 'Move down' }).first().click({ force: true });

        const after_first = await name_of(0);
        const after_second = await name_of(1);

        // The two names must have swapped positions.
        expect(after_first).toBe(before_second);
        expect(after_second).toBe(before_first);
    });

    test('Count-in bars spinbutton preserves an invalid draft until blur, then reverts it', async ({ page }) => {
        const count_in = page.getByRole('spinbutton', { name: 'Count-in bars' });

        await count_in.fill('4');
        await expect(count_in).toHaveValue('4');

        // Keep an invalid draft visible while editing so the field does not
        // silently discard the user's keystroke.
        await count_in.fill('9');
        await expect(count_in).toHaveValue('9');

        // Leaving the field rejects the invalid draft and restores the last
        // committed value.
        await count_in.blur();
        await expect(count_in).toHaveValue('4');

        // 0 is valid.
        await count_in.fill('0');
        await expect(count_in).toHaveValue('0');
    });
});

// ---------------------------------------------------------------------------
// Prompt bar — destructive commands open a confirm/cancel preview; cancelling
// preserves state, confirming mutates state and shows an AI change toast.
// ---------------------------------------------------------------------------

test.describe('Prompt bar — preview and execution', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Destructive command opens a confirm/cancel preview; cancelling keeps tracks', async ({ page }) => {
        const prompt = page.getByRole('textbox', { name: 'Prompt command input' });
        await prompt.fill('Delete Track');
        await page.getByRole('option', { name: /Delete Track/i }).click();

        // Preview row appears only for destructive actions.
        const confirm = page.getByRole('button', { name: 'Confirm actions' });
        const cancel = page.getByRole('button', { name: 'Cancel actions' });
        await expect(confirm).toBeVisible();
        await expect(cancel).toBeVisible();

        // Cancelling clears the preview without removing any track.
        const track_rows = page.getByRole('grid', { name: /Track list/i }).locator(':scope > [role="row"]');
        const track_rows_before = await track_rows.count();
        await cancel.click();
        await expect(confirm).toHaveCount(0);
        const track_rows_after = await track_rows.count();
        expect(track_rows_after).toBe(track_rows_before);
    });

    test('Confirming a destructive command removes tracks and shows an AI change toast', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const track_rows = track_list.locator(':scope > [role="row"]');
        const rows_before = await track_rows.count();
        expect(rows_before).toBeGreaterThan(0);

        await page.getByRole('textbox', { name: 'Prompt command input' }).fill('Delete Track');
        await page.getByRole('option', { name: /Delete Track/i }).click();

        const confirm = page.getByRole('button', { name: 'Confirm actions' });
        await expect(confirm).toBeVisible();
        await confirm.click();

        await expect(track_rows).toHaveCount(rows_before - 1);

        // The AI change toast (role=status with Undo/Dismiss) reports the confirmed action.
        const toast = ai_toast(page);
        await expect(toast).toBeVisible();
        await expect(toast.getByText(/Confirmed:.*Delete Track/i)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Take lane / comping — the Flatten comp + Initialize buttons only appear once
// variation lanes are toggled on the track header. Flatten is disabled until a
// lane is initialized, then becomes enabled.
// ---------------------------------------------------------------------------

test.describe('Arrangement take lane — flatten comp state', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
        // Variation lanes toggle reveals the take-lane panel.
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('button', { name: 'Toggle variation lanes' }).first().click();
    });

    test('Flatten comp is disabled until a take lane is initialized, then enabled', async ({ page }) => {
        const flatten = page.getByRole('button', { name: 'Flatten comp' });
        await expect(flatten).toBeVisible();
        await expect(flatten).toBeDisabled();

        await page.getByRole('button', { name: 'Initialize take lane' }).click();
        await expect(flatten).toBeEnabled();
    });
});

// ---------------------------------------------------------------------------
// Master track — on a fresh project the inspector already falls back to the
// master track, so "Analysis & Metering" is visible immediately. Selecting a
// different track removes it; re-selecting master via the spectrum widget
// brings it back. This is the real selection-state behavior.
// ---------------------------------------------------------------------------

test.describe('Master track selection', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Adding a track hides master Analysis & Metering; Master Track Spectrum restores it', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const am = inspector.getByText('Analysis & Metering');

        // Fresh launch: nothing else selected → master is the fallback selection → section visible.
        await expect(am).toBeVisible();

        // Adding a MIDI track selects it → master-only section disappears.
        await add_track(page, 'MIDI');
        await expect(am).toHaveCount(0);

        // Re-select master via the spectrum widget → section returns.
        await page.getByRole('button', { name: 'Master Track Spectrum' }).click();
        await expect(am).toBeVisible();
    });
});
