import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// The Crust limiter's Release *time* and Lookahead knobs (AutoKnob/Knob →
// RotaryKnob in CrustControlZone Level2Core) are role="slider" bound to
// patch.release and patch.lookahead. Like the Attack time knob
// (crustAttackTimeTestId.spec.ts), the RotaryKnob's accessible name falls back
// to "Parameter control" — neither wrapper passes an aria-label — so there are
// three identically-named knobs in the timing row and each must be scoped via a
// uniquely-named sibling switch:
//   • Release knob  — its AutoKnob container owns the "Release auto" switch.
//   • Lookahead knob — the plain Knob has no auto switch; it is the *preceding
//     sibling* of the Attack AutoKnob container, so it is reached from the
//     "Attack auto" switch via xpath parent → nearest preceding sibling.
// Default patch.release is 0 and patch.lookahead is 2 (CrustPatch.ts); neither
// is at its max, so ArrowUp increments both and aria-valuenow must reflect the
// committed value. Keyboard input also bypasses the pointer-overlap hazard
// (timing row sits under the waveform card) that affects clicks in this panel.
test.describe('Crust release-time and lookahead knobs — aria-valuenow changes on keyboard input', () => {
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

    test('ArrowUp increments the release-time aria-valuenow', async ({ page }) => {
        // The Release AutoKnob wrapper holds the "Release auto" switch and its
        // sibling RotaryKnob (role="slider"). Anchor on the uniquely-named
        // switch and scope to its parent container to pick the Release knob out
        // of the three "Parameter control" knobs in the timing row.
        const releaseAutoSwitch = page.getByRole('switch', { name: 'Release auto' });
        const releaseSlider = releaseAutoSwitch.locator('xpath=..').getByRole('slider');

        await expect(releaseSlider).toBeVisible({ timeout: 15_000 });

        // Default patch.release is 0 (CrustPatch.ts) → aria-valuenow "0".
        await expect(releaseSlider).toHaveAttribute('aria-valuenow', '0');

        // ArrowUp increments by the knob's 5 ms step (0 → 5).
        await releaseSlider.press('ArrowUp');
        await page.waitForTimeout(300);

        const after = await releaseSlider.getAttribute('aria-valuenow');
        expect(Number(after)).toBeGreaterThan(0);
    });

    test('ArrowUp increments the lookahead aria-valuenow', async ({ page }) => {
        // The Lookahead knob is a plain Knob (no auto toggle). It renders as the
        // first child of the timing row, immediately before the Attack AutoKnob.
        // Reach it from the uniquely-named "Attack auto" switch: step up to its
        // parent (Attack wrapper), then to the nearest preceding sibling (the
        // Lookahead wrapper), and read the role="slider" inside.
        const attackAutoSwitch = page.getByRole('switch', { name: 'Attack auto' });
        const lookaheadSlider = attackAutoSwitch
            .locator('xpath=../preceding-sibling::*[1]')
            .getByRole('slider');

        await expect(lookaheadSlider).toBeVisible({ timeout: 15_000 });

        // Default patch.lookahead is 2 (CrustPatch.ts) → aria-valuenow "2".
        await expect(lookaheadSlider).toHaveAttribute('aria-valuenow', '2');

        // ArrowUp increments by the knob's 0.1 ms step (2 → 2.1).
        await lookaheadSlider.press('ArrowUp');
        await page.waitForTimeout(300);

        const after = await lookaheadSlider.getAttribute('aria-valuenow');
        expect(Number(after)).toBeGreaterThan(2);
    });
});
