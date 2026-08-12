import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Opens the Grand Boule piano panel from the Browser panel. Grand Boule is a
 * "House Special" instrument card: clicking it creates its MIDI track, attaches
 * the device, and mounts the panel in one step. The panel-mounted contract is
 * the Close control — it appears once the panel has rendered.
 */
async function open_grand_boule_panel(page: import('@playwright/test').Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();
    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible({ timeout: 15_000 });
}

// The Realism section's attack "Bite" knob and the Radiation section's mic
// "Position" were the last two Grand Boule controls without value-change
// coverage. Bite is a rotary Knob (role="slider") addressable by its forwarded
// label and driven by keyboard. Position is a native <select> (role="combobox",
// aria-label="Microphone position"): it carries no aria-valuenow and synthesized
// ArrowDown does not commit a new option in headless Chromium, so — matching the
// repo's other select specs (pianoRollScale, expressionLane, chordExpression) —
// it is driven via selectOption and asserted on its numeric option value
// (Close 0 / Player 1 / Room 2, default 1).
test.describe('Grand Boule Bite + Position — value changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_grand_boule_panel(page);
    });

    test('the Bite (attack bite) knob responds to keyboard', async ({ page }) => {
        const bite = page.getByRole('slider', { name: 'Bite' });
        await expect(bite).toBeVisible({ timeout: 5000 });
        await bite.focus();
        const before = Number(await bite.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await bite.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('the Position (microphone position) selector updates its value', async ({ page }) => {
        // Mic position is a native <select> (not a rotary knob): it exposes no
        // aria-valuenow, and synthesized ArrowDown does not commit a new option
        // in headless Chromium, so the select is driven via selectOption — the
        // same pattern used by the other select specs in this suite. Its options
        // carry numeric values (Close 0 / Player 1 / Room 2); the default is 1.
        const micPosition = page.getByRole('combobox', { name: 'Microphone position' });
        await expect(micPosition).toBeVisible({ timeout: 5000 });
        await expect(micPosition).toHaveValue('1');

        await micPosition.selectOption('Room');

        await expect(micPosition).toHaveValue('2');
    });
});
