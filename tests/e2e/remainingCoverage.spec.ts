import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Panel toggles — aria-pressed state', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toggle track list flips aria-pressed and hides the grid', async ({ page }) => {
        // Seed a track so the grid actually renders (empty projects show no grid).
        await add_track(page, 'MIDI');
        const toggle = page.getByRole('button', { name: 'Toggle track list' });
        const grid = page.getByRole('grid', { name: /Track list/i });

        // Default: track list open, grid visible.
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(grid).toBeVisible();

        await toggle.click();

        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(grid).toHaveCount(0);
    });

    test('Toggle Session + Arrangement View flips aria-pressed', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle Session + Arrangement View' });
        const before = await toggle.getAttribute('aria-pressed');
        await toggle.click();
        await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Generate button toggles the generative AI panel via aria-pressed', async ({ page }) => {
        const generate = page.getByRole('button', { name: 'Generate', exact: true });
        await expect(generate).toHaveAttribute('aria-pressed', 'false');

        await generate.click();

        await expect(generate).toHaveAttribute('aria-pressed', 'true');
    });

    test('AI chat panel toggle flips aria-pressed', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle AI chat panel' });
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        await toggle.click();

        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });

    test('AI action history toggle reveals the history panel', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle AI action history' });
        // The panel's Close button only renders when the panel is open.
        const close = page.getByRole('button', { name: 'Close action history' });

        await expect(close).toHaveCount(0);
        await toggle.click();
        await expect(close).toBeVisible();
    });
});

test.describe('Tempo map — add a tempo change', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toggling the tempo map reveals the editor and adding a change grows the list', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle tempo map' });

        // Before: collapsed, no editor dialog.
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByRole('dialog', { name: 'Tempo map editor' })).toHaveCount(0);

        await toggle.click();

        // After: expanded, dialog visible with empty state.
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('No tempo changes')).toBeVisible();

        // Add a tempo change at beat 8, 140 BPM.
        await dialog.getByRole('spinbutton', { name: 'New tempo change beat' }).fill('8');
        await dialog.getByRole('spinbutton', { name: 'New tempo change BPM' }).fill('140');
        await dialog.getByRole('button', { name: 'Add tempo change' }).click();

        // The empty state is gone and a change row referencing beat 8 appears.
        await expect(dialog.getByText('No tempo changes')).toHaveCount(0);
        await expect(dialog.getByText(/Beat 8/)).toBeVisible();
    });
});

test.describe('Overdub toggle (armed MIDI track)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        // Arm the track so the overdub control appears.
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('button', { name: /^Arm / }).first().click();
    });

    test('Overdub button flips aria-pressed when toggled', async ({ page }) => {
        const overdub = page.getByRole('button', { name: 'Overdub' });
        await expect(overdub).toBeVisible();
        await expect(overdub).toHaveAttribute('aria-pressed', 'false');

        await overdub.click();
        await expect(overdub).toHaveAttribute('aria-pressed', 'true');

        await overdub.click();
        await expect(overdub).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('Undo state transitions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Undo button is disabled on a clean project and enabled after an action', async ({ page }) => {
        const undo = page.getByRole('button', { name: 'Undo', exact: true });

        // A fresh project has no undo history → button disabled.
        await expect(undo).toBeDisabled();

        // Performing a track add pushes an undoable entry.
        await add_track(page, 'MIDI');

        await expect(undo).toBeEnabled();
    });
});

test.describe('Browser Instruments tab', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Instruments tab lists the built-in devices', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Instruments', exact: true }).click();

        const devices = browser.getByRole('button', { name: /Fermenter|Toaster|Levain|Crumbs/i });
        await expect(devices.first()).toBeVisible();
        expect(await devices.count()).toBeGreaterThan(0);
    });
});
