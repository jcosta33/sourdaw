import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
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
// Piano-roll toolbar toggles — each flips aria-pressed when clicked.
// ---------------------------------------------------------------------------

test.describe('Piano-roll toolbar — toggle state', () => {
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

    test('Constrain-notes-to-scale toggle flips aria-pressed', async ({ page }) => {
        const constrain = page.getByRole('button', { name: 'Constrain notes to scale' });
        const before = await constrain.getAttribute('aria-pressed');
        await constrain.click();
        await expect(constrain).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Step-input-mode toggle flips aria-pressed', async ({ page }) => {
        const step = page.getByRole('button', { name: 'Toggle step input mode' });
        const before = await step.getAttribute('aria-pressed');
        await step.click();
        await expect(step).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Ghost-notes toggle flips aria-pressed', async ({ page }) => {
        const ghost = page.getByRole('button', { name: 'Toggle ghost notes' });
        const before = await ghost.getAttribute('aria-pressed');
        await ghost.click();
        await expect(ghost).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Paint-mode toggle flips aria-pressed', async ({ page }) => {
        const paint = page.getByRole('button', { name: 'Toggle paint mode' });
        const before = await paint.getAttribute('aria-pressed');
        await paint.click();
        await expect(paint).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Chord-stamp-mode toggle flips aria-pressed', async ({ page }) => {
        const chord = page.getByRole('button', { name: 'Toggle chord stamp mode' });
        const before = await chord.getAttribute('aria-pressed');
        await chord.click();
        await expect(chord).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Expression-view toggle reveals the Active expression lane combobox', async ({ page }) => {
        const expr = page.getByRole('button', { name: /Toggle Expression View/i });
        const lane = page.getByRole('combobox', { name: /Active expression lane/i });
        await expect(lane).toHaveCount(0);

        await expr.click();

        await expect(lane).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Piano-roll scale selectors — changing root/type updates the combobox value.
// ---------------------------------------------------------------------------

test.describe('Piano-roll — scale selectors', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_midi_editor(page);
    });

    test('Scale root and type comboboxes are present and hold a value', async ({ page }) => {
        const root = page.getByRole('combobox', { name: /Scale root note/i });
        const type = page.getByRole('combobox', { name: /Scale type/i });
        await expect(root).toBeVisible();
        await expect(type).toBeVisible();

        // Both expose at least one option.
        expect(await root.locator('option').count()).toBeGreaterThan(0);
        expect(await type.locator('option').count()).toBeGreaterThan(0);
    });

    test('Changing the scale root updates the selected value', async ({ page }) => {
        const root = page.getByRole('combobox', { name: /Scale root note/i });
        const before = await root.inputValue();

        // Pick a different root by selecting the last option label.
        const options = await root.locator('option').allInnerTexts();
        const target = options[options.length - 1];
        await root.selectOption({ label: target });

        // The selected value must have changed (option values are numeric ids).
        expect(await root.inputValue()).not.toBe(before);
    });
});

// ---------------------------------------------------------------------------
// Piano-roll zoom slider — holds a numeric aria-valuenow.
// ---------------------------------------------------------------------------

test.describe('Piano-roll — zoom', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_midi_editor(page);
    });

    test('Zoom slider exposes a numeric value', async ({ page }) => {
        const zoom = page.getByRole('slider', { name: /Piano roll zoom/i });
        await expect(zoom).toBeVisible();
        // PianoRoll.tsx defaults `zoom` to 1 (`useState(1)`), rendered by
        // PianoRollToolbar.tsx as `zoom * 100`.
        await expect(zoom).toHaveAttribute('aria-valuenow', '100');
    });
});
