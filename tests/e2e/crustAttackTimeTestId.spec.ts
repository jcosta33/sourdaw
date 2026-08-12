import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// The Crust limiter's Attack *time* knob (AutoKnob → RotaryKnob in
// CrustControlZone Level2Core) is a role="slider" bound to patch.attack. The
// attack-auto *toggle* is covered by crustAttackAutoTestId.spec.ts; this test
// exercises the manual time value itself. The RotaryKnob's accessible name
// falls back to "Parameter control" (AutoKnob passes no aria-label), so there
// are three identically-named knobs in the panel — the slider is scoped to the
// Attack AutoKnob container via its uniquely-named "Attack auto" switch sibling.
// Default patch.attack is 0 (CrustPatch.ts); ArrowUp increments by the knob's
// 0.5 ms step and aria-valuenow must reflect the committed value.
test.describe('Crust attack time knob — aria-valuenow changes on keyboard input', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('ArrowUp increments the attack time aria-valuenow', async ({ page }) => {
        // The Attack AutoKnob wrapper holds the "Attack auto" switch and its
        // sibling RotaryKnob (role="slider"). Anchor on the uniquely-named
        // switch and scope to its parent container to pick the Attack knob out
        // of the three "Parameter control" knobs in the timing row.
        const attackAutoSwitch = page.getByRole('switch', { name: 'Attack auto' });
        const attackSlider = attackAutoSwitch.locator('xpath=..').getByRole('slider');

        await expect(attackSlider).toBeVisible({ timeout: 15_000 });

        // Default patch.attack is 0 (CrustPatch.ts) → aria-valuenow "0".
        await expect(attackSlider).toHaveAttribute('aria-valuenow', '0');

        // ArrowUp increments by step (0.5 ms). Keyboard input bypasses the
        // pointer-overlap hazard (timing row sits under the waveform card) that
        // affects click-based interactions in this panel.
        await attackSlider.press('ArrowUp');
        await page.waitForTimeout(300);

        const after = await attackSlider.getAttribute('aria-valuenow');
        expect(Number(after)).toBeGreaterThan(0);
    });
});
