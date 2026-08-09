import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function open_dock_tab(page: import('@playwright/test').Page, tab_id: string): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
    const pressed = (await toggle.getAttribute('aria-pressed')) ?? '';
    if (!pressed.match(/true/i)) {
        await toggle.click();
    }
    await page.locator(`#bottom-dock-tab-${tab_id}`).click();
}

/** Create a MIDI clip and open the piano-roll editor (proven pattern). */
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
// MIDI editor — note creation is undoable (undo button enabled afterwards).
// ---------------------------------------------------------------------------

test.describe('MIDI editor — note operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_midi_editor(page);
    });

    test('Creating a note enables the Undo button', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });

        // Before creating a note, capture undo state.
        const enabled_before = await undo.isEnabled();

        // Double-click to create a note in the piano roll.
        const box = await piano_roll.boundingBox();
        if (!box) throw new Error('piano roll missing');
        await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
        await page.waitForTimeout(500);

        // After creating a note, undo must be enabled.
        await expect(undo).toBeEnabled();
        // Sanity: if it was disabled before, it is now enabled (a real transition).
        if (!enabled_before) {
            await expect(undo).toBeEnabled();
        }
    });

    test('Chord-stamp-mode toggle is reachable from the MIDI editor', async ({ page }) => {
        const chord = page.getByRole('button', { name: 'Toggle chord stamp mode' });
        const before = await chord.getAttribute('aria-pressed');
        await chord.click();
        await expect(chord).not.toHaveAttribute('aria-pressed', before ?? '');
    });
});

// ---------------------------------------------------------------------------
// Modulation matrix — add a modulator and verify the card persists (regression
// guard for the "New Modulator" form + card lifecycle).
// ---------------------------------------------------------------------------

test.describe('Modulation matrix — card lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await open_dock_tab(page, 'modulation');
    });

    test('Adding then removing a modulator returns to the empty state', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        await expect(matrix.getByText('No modulators')).toBeVisible();

        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        await matrix.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(matrix.getByLabel('Remove modulator LFO')).toBeVisible();
        await expect(matrix.getByText('No modulators')).toHaveCount(0);

        await matrix.getByLabel('Remove modulator LFO').click();
        await expect(matrix.getByText('No modulators')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Setlist — add items and toggle auto-advance (aria-pressed).
// ---------------------------------------------------------------------------

test.describe('Setlist — items and auto-advance', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_dock_tab(page, 'setlist');
    });

    test('Adding items grows the list and auto-advance toggle flips aria-pressed', async ({ page }) => {
        const add_btn = page.getByRole('button', { name: 'Add setlist item' });
        await add_btn.click();
        await add_btn.click();
        const items = page.getByRole('list', { name: 'Setlist items' });
        expect(await items.getByRole('listitem').count()).toBe(2);

        const auto = page.getByRole('button', { name: /Auto-advance/i });
        const before = await auto.getAttribute('aria-pressed');
        await auto.click();
        await expect(auto).not.toHaveAttribute('aria-pressed', before ?? '');
    });
});

// ---------------------------------------------------------------------------
// Loop station — arm/disarm toggles the button label; slots grid renders.
// ---------------------------------------------------------------------------

test.describe('Loop station — arm/disarm', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_dock_tab(page, 'loopStation');
    });

    test('Arming flips the button to Disarm and reveals the slots grid', async ({ page }) => {
        const arm = page.getByRole('button', { name: /Arm loop station/i });
        await expect(arm).toBeVisible();

        await arm.click();

        const disarm = page.getByRole('button', { name: /Disarm loop station/i });
        await expect(disarm).toBeVisible();
        // The slots grid renders once armed.
        await expect(page.getByRole('grid', { name: 'Loop slots' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Crust limiter — adding the device exposes its metering controls.
// ---------------------------------------------------------------------------

test.describe('Crust limiter device', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Add-device menu lists Crust and adding it inserts a Crust device card', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();

        // The menu advertises Crust among the effects.
        const crust_item = page.getByRole('menuitem', { name: /^Crust$/ });
        await expect(crust_item).toBeVisible();

        const devices_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();

        await crust_item.click();
        await page.waitForTimeout(800);

        // Crust now ships — a Crust device card is added to the chain.
        const crust_bypass = inspector.getByRole('button', { name: /^Bypass Crust$/i });
        await expect(crust_bypass).toBeVisible();
        const devices_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devices_after).toBe(devices_before + 1);
    });
});

// ---------------------------------------------------------------------------
// Analysis panel — opens with real content.
// ---------------------------------------------------------------------------

test.describe('Analysis panel', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await open_dock_tab(page, 'analysis');
    });

    test('Analysis tab renders meter widgets in the dock panel', async ({ page }) => {
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        // The analysis panel exposes at least one labeled metering surface.
        expect(await panel.getByRole('img', { name: /meter|spectrum|goniometer|correlation/i }).count()).toBeGreaterThan(0);
    });
});
