import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Inspector — Automation lane add/remove mutates the lane list.
// ---------------------------------------------------------------------------

test.describe('Inspector — Automation lane add/remove', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Adding a Gain automation lane creates a removable lane row', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        // Before: empty state, no Remove-lane buttons.
        await expect(inspector.getByText('No automation lanes yet')).toBeVisible();
        expect(await inspector.getByRole('button', { name: 'Remove lane' }).count()).toBe(0);

        await inspector.getByRole('button', { name: /Add automation lane/i }).click();
        // "Gain" appears under the Track section (first); a device Gain also exists, so take first.
        await page.getByRole('menuitem', { name: 'Gain', exact: true }).first().click();

        // After: a lane row showing "Gain" exists and is removable.
        await expect(inspector.getByText('Gain', { exact: true }).first()).toBeVisible();
        const remove = inspector.getByRole('button', { name: 'Remove lane' });
        await expect(remove).toBeVisible();

        await remove.click();
        // Back to empty state.
        await expect(inspector.getByText('No automation lanes yet')).toBeVisible();
        expect(await inspector.getByRole('button', { name: 'Remove lane' }).count()).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Inspector — Track alternatives: create increments the count; delete buttons
// appear only once more than one alternative exists.
// ---------------------------------------------------------------------------

test.describe('Inspector — Track alternatives', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Creating an alternative adds a row and reveals delete buttons', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        // A fresh track starts with exactly one alternative → no delete buttons.
        expect(await inspector.getByRole('button', { name: /^Delete / }).count()).toBe(0);

        await inspector.getByRole('button', { name: 'Create new alternative' }).click();

        // Now two alternatives exist → a delete button for each is visible.
        const deletes = inspector.getByRole('button', { name: /^Delete / });
        await expect(deletes.first()).toBeVisible();
        expect(await deletes.count()).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// Inspector — Signal Flow section expands to reveal the routing graph SVG.
// ---------------------------------------------------------------------------

test.describe('Inspector — Signal Flow section', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        // Select the first track so the inspector renders track sections.
        await page.getByRole('grid', { name: /Track list/i }).getByRole('row').first().click();
    });

    test('Signal Flow button toggles aria-expanded and reveals the routing graph', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const signal_flow = inspector.getByRole('button', { name: 'Signal Flow' });
        const graph = page.getByRole('img', { name: 'Signal routing graph' });

        await expect(signal_flow).toHaveAttribute('aria-expanded', 'false');
        await expect(graph).toHaveCount(0);

        await signal_flow.click();

        await expect(signal_flow).toHaveAttribute('aria-expanded', 'true');
        await expect(graph).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Inspector — Create Bus adds new rows to the track list grid.
// (Each track occupies two grid rows: header + body.)
// ---------------------------------------------------------------------------

test.describe('Inspector — Sends & Bus Routing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
    });

    test('Create Bus button adds a bus track to the track list', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const create_bus = inspector.getByRole('button', { name: 'Create Bus' });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const rows_before = await track_list.getByRole('row').count();

        await create_bus.click();

        const rows_after = await track_list.getByRole('row').count();
        expect(rows_after).toBeGreaterThan(rows_before);
        // The new bus track is visible by name.
        await expect(track_list.getByText('Bus 1', { exact: true }).first()).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Clip context menu — verify the real menuitem names appear for a MIDI clip.
// Clips are canvas-rendered; we assert menu content, not DOM clip elements.
// ---------------------------------------------------------------------------

test.describe('Clip context menu operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        const canvas = page.getByLabel('Timeline editor surface');
        // Create a clip via the empty-surface menu at the first track lane (y=30).
        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });
        const add = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await add.click();
        await page.waitForTimeout(500);
    });

    test('MIDI clip context menu exposes the exact operation names', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        // Right-click the clip at the same position to open the clip menu.
        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const names = await menu.getByRole('menuitem').allInnerTexts();
        const flat = names.join(' | ');

        // Core operations present for any clip.
        expect(flat).toMatch(/Split at Cursor/);
        expect(flat).toMatch(/Duplicate/);
        expect(flat).toMatch(/Delete/);
        expect(flat).toMatch(/Rename Clip/);
        // MIDI-only operations.
        expect(flat).toMatch(/Open Inline Editor|Arpeggiate/);
    });

    test('Rename Clip opens an inline editor that commits the new name', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });

        await page.getByRole('menuitem', { name: /Rename Clip/i }).click();

        const editor = page.getByRole('menu').getByRole('textbox');
        await expect(editor).toBeVisible();
        await editor.fill('Renamed Clip');
        await editor.press('Enter');

        // The inline editor closes on commit.
        await expect(editor).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// MIDI editor — expression view toggle + fold-to-scale toggle (aria-pressed).
// ---------------------------------------------------------------------------

test.describe('MIDI editor — advanced lane controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        // Create a MIDI clip then open the editor by double-clicking it (proven pattern).
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);
        await canvas.dblclick({ position: { x: 300, y: 30 } });
    });

    test('Fold-to-scale toggle flips aria-pressed', async ({ page }) => {
        const fold = page.getByRole('button', { name: 'Toggle fold to scale' });
        await fold.waitFor({ state: 'visible' });

        const fold_before = await fold.getAttribute('aria-pressed');
        await fold.click();
        await expect(fold).not.toHaveAttribute('aria-pressed', fold_before ?? '');
    });

    test('Expression view toggle reveals the Active expression lane combobox', async ({ page }) => {
        const expr_toggle = page.getByRole('button', { name: /Toggle Expression View/i });
        await expr_toggle.waitFor({ state: 'visible' });

        // Before enabling, the lane combobox is absent.
        const lane = page.getByRole('combobox', { name: /Active expression lane/i });
        await expect(lane).toHaveCount(0);

        await expr_toggle.click();

        await expect(lane).toBeVisible();
        // Velocity is the only always-available expression lane. The MPE per-note
        // lanes (Pitch Bend / Pressure / Slide) are intentionally hidden until the
        // engine sounds them (audit MD-2, honest-availability flag — #719), so the
        // combobox must surface Velocity and must NOT surface the MPE lanes.
        const opts = await lane.locator('option').allInnerTexts();
        const joined = opts.join('|');
        expect(joined).toMatch(/Velocity/);
        expect(joined).not.toMatch(/Pitch Bend|Pressure|Slide/);
    });
});

// ---------------------------------------------------------------------------
// Track header — Input monitoring cycles Auto → On → Off → Auto.
// The label (not aria-pressed) is the observable state.
// ---------------------------------------------------------------------------

test.describe('Track header — Input monitoring cycle', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
    });

    test('Input monitoring cycles Auto → On → Off → Auto via aria-label', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const monitor = track_list.getByRole('button', { name: /Input monitoring/i }).first();

        await expect(monitor).toHaveAccessibleName(/Input monitoring: Auto/i);

        await monitor.click();
        await expect(monitor).toHaveAccessibleName(/Input monitoring: On/i);

        await monitor.click();
        await expect(monitor).toHaveAccessibleName(/Input monitoring: Off/i);

        await monitor.click();
        await expect(monitor).toHaveAccessibleName(/Input monitoring: Auto/i);
    });
});

// ---------------------------------------------------------------------------
// Routing tab — toggle a route cell and observe the Connect/Disconnect flip.
// ---------------------------------------------------------------------------

test.describe('Routing matrix — route toggle', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-routing').click();
    });

    test('Clicking a routing cell flips its aria-label Connect → Disconnect', async ({ page }) => {
        // The first Connect cell toggles a route between a source and a destination.
        const connect_cell = page.getByRole('button', { name: /^Connect / }).first();
        await expect(connect_cell).toBeVisible();

        const label_before = await connect_cell.getAttribute('aria-label');
        await connect_cell.click();

        // After connecting, the same cell is now labelled Disconnect.
        const disconnect_cell = page.getByRole('button', { name: /^Disconnect / }).first();
        await expect(disconnect_cell).toBeVisible();
        const label_after = await disconnect_cell.getAttribute('aria-label');

        expect(label_before).toMatch(/^Connect /);
        expect(label_after).toMatch(/^Disconnect /);
    });
});

// ---------------------------------------------------------------------------
// Chord track (Pop Song template) — clear empties the chord list and hides
// the clear button (gated on events.length > 0).
// ---------------------------------------------------------------------------

test.describe('Chord track — add and clear', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await page.getByRole('group', { name: 'Playback controls' }).waitFor({ state: 'visible', timeout: 10000 });
    });

    test('Clear all chords removes every chord block and hides itself', async ({ page }) => {
        const chord_track = page.getByRole('region', { name: 'Chord track' });
        await expect(chord_track).toBeVisible();

        // Pop Song seeds chords → chord blocks exist.
        const chord_blocks = chord_track.getByRole('button', { name: /chord at beat/i });
        const initial = await chord_blocks.count();
        expect(initial).toBeGreaterThan(0);

        const clear = chord_track.getByRole('button', { name: 'Clear all chords' });
        await clear.click();

        // All chord blocks gone, and the Clear button hides itself (gated on events>0).
        await expect(chord_blocks).toHaveCount(0);
        await expect(clear).toHaveCount(0);
    });
});
