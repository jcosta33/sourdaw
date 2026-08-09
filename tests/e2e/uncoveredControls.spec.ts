import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Overlay close & dismiss — verify real open→closed state transitions.
// ---------------------------------------------------------------------------

test.describe('Overlay close & dismiss', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Inspector close button hides the inspector panel', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();

        await inspector.getByRole('button', { name: 'Close inspector' }).click();

        await expect(inspector).toHaveCount(0);
    });

    test('Undo history panel opens and closes via its toggle', async ({ page }) => {
        const toggle = page.getByRole('button', { name: /Toggle undo history panel/i });
        const close = page.getByRole('button', { name: 'Close undo history' });

        await expect(close).toHaveCount(0);
        await toggle.click();
        await expect(close).toBeVisible({ timeout: 5000 });

        // Close via the toggle (the inner Close button can be intercepted by overlays).
        await toggle.click();
        await expect(close).toHaveCount(0);
    });

    test('Shortcut cheat sheet opens with ? and closes with Escape', async ({ page }) => {
        await page.locator('#main-content').click();
        const sheet = page.getByRole('dialog', { name: /Keyboard shortcuts/i });

        await expect(sheet).toHaveCount(0);
        await page.keyboard.press('Shift+Slash');
        await expect(sheet).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Preferences — controls hold real values; changing them commits.
// ---------------------------------------------------------------------------

test.describe('Preferences settings', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        await page.getByRole('dialog').filter({ hasText: /Preferences/i }).waitFor({ state: 'visible', timeout: 5000 });
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });

    test('Performance section exposes the audio-processing-profile selector and switches its description', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        // Navigate to the Performance section (not the default General view).
        await dialog.getByRole('button', { name: 'Performance', exact: true }).click();

        const profile = dialog.getByRole('combobox', { name: 'Audio processing profile' });
        await expect(profile).toBeVisible();
        // Two named profiles are offered (low-latency and high-capacity).
        expect(await profile.locator('option').count()).toBeGreaterThanOrEqual(2);

        // The descriptive paragraph tracks the selected profile, so changing the
        // select is a state change a test can observe — not a static control.
        const description = dialog.getByText(/Chrome chooses the actual device latency/i);
        // Default is low-latency → live-playing copy.
        await expect(description).toContainText('live playing');
        await profile.selectOption('highCapacity');
        await expect(description).toContainText('dense sessions');
    });

    test('Appearance section exposes a UI scale slider with a value', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();

        const scale = dialog.getByRole('slider', { name: /UI Scale/i });
        await expect(scale).toBeVisible();
        const value = await scale.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
        expect(Number(value)).toBeGreaterThan(0);
    });

    test('MIDI section exposes a default velocity slider in range', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await dialog.getByRole('button', { name: 'MIDI', exact: true }).click();

        const velocity = dialog.getByRole('slider', { name: /Default MIDI velocity/i });
        await expect(velocity).toBeVisible();
        const value = Number(await velocity.getAttribute('aria-valuenow'));
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(127);
    });
});

// ---------------------------------------------------------------------------
// Tempo editor — toggle opens/closes the map; tap tempo stays interactive.
// ---------------------------------------------------------------------------

test.describe('Tempo editor controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Tempo map toggle flips aria-expanded', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle tempo map' });
        const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });

        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(dialog).toHaveCount(0);

        await toggle.click();

        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(dialog).toBeVisible();
    });

    test('Tap tempo button remains enabled across repeated taps', async ({ page }) => {
        const tap = page.getByRole('button', { name: 'Tap tempo' });
        for (let i = 0; i < 4; i++) {
            await tap.click();
            await page.waitForTimeout(150);
        }
        await expect(tap).toBeEnabled();
    });

    test('Time signature readout shows 4/4', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Time signature/i })).toContainText('4/4');
    });
});

// ---------------------------------------------------------------------------
// Track list header — add/folder/organize/height controls are present.
// ---------------------------------------------------------------------------

test.describe('Arrangement track controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Track list header exposes add-track, add-folder, and AI-organize buttons', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Add track' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add folder' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Auto-organize with AI' })).toBeVisible();
    });

    test('Creating an alternative from the inspector reveals delete buttons', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        // One default alternative → no delete buttons.
        expect(await inspector.getByRole('button', { name: /^Delete / }).count()).toBe(0);

        await inspector.getByRole('button', { name: 'Create new alternative' }).click();

        // Two alternatives → delete buttons appear.
        const deletes = inspector.getByRole('button', { name: /^Delete / });
        await expect(deletes.first()).toBeVisible();
        expect(await deletes.count()).toBeGreaterThanOrEqual(2);
    });

    test('MIDI output destination combobox is present for a MIDI track', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByRole('combobox', { name: 'MIDI output destination' })).toBeVisible();
    });
});
