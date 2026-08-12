import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    // The Toaster card must be reachable; if it is not, fail rather than skip.
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the first pad renders once ToasterPanel is up.
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// Per-pad sound-shaping knobs the other Toaster e2e specs leave untouched.
// "Tone" is covered by toasterPerPadParamsTestId.spec.ts and "Crunch" (drive) by
// toasterPadDriveTestId.spec.ts. This covers the remaining selected-pad shaping
// pair: "Hit" (decay envelope) and "Bright" (filter cutoff). Both are
// RotaryKnobs (`role="slider"`) wired to `setToasterPadParam`; keyboard nudges
// must move `aria-valuenow` by the declared step.
//
// Direction matters: a knob parked at its maximum ignores ArrowUp (the knob
// clamps and the keypress is a no-op), so each case reads the current value
// first and picks the direction that has room to move.
//   - Hit:    default 0.5, range 0–1,    step 0.01  → ArrowUp moves it up.
//   - Bright: default 20000 (the max), range 20–20000, step 10 → ArrowDown moves it down.
test.describe('Toaster per-pad Hit & Bright knobs — keyboard control', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('keyboard nudge moves the selected pad Hit (decay) knob', async ({ page }) => {
        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();

        const hitKnob = page.getByRole('slider', { name: 'Hit' });
        await expect(hitKnob).toBeVisible({ timeout: 5000 });

        const before = Number(await hitKnob.getAttribute('aria-valuenow'));
        await hitKnob.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await hitKnob.getAttribute('aria-valuenow'));

        // Declared step is 0.01; ArrowUp must land exactly one step above.
        expect(after).toBeGreaterThan(before);
        expect(after).toBeCloseTo(before + 0.01, 5);
    });

    test('keyboard nudge moves the selected pad Bright (filter cutoff) knob', async ({ page }) => {
        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();

        const brightKnob = page.getByRole('slider', { name: 'Bright' });
        await expect(brightKnob).toBeVisible({ timeout: 5000 });

        const before = Number(await brightKnob.getAttribute('aria-valuenow'));
        // The default cutoff is the knob maximum (20000 Hz), so ArrowUp is a
        // no-op there. Drive it the only direction that has room: down.
        const max = Number(await brightKnob.getAttribute('aria-valuemax'));
        const direction = before >= max ? 'ArrowDown' : 'ArrowUp';
        const expectedDelta = direction === 'ArrowDown' ? -10 : 10;

        await brightKnob.focus();
        await page.keyboard.press(direction);
        await page.waitForTimeout(200);
        const after = Number(await brightKnob.getAttribute('aria-valuenow'));

        // Declared step is 10 Hz; the nudge must land exactly one step away.
        expect(after).not.toBe(before);
        expect(after).toBeCloseTo(before + expectedDelta, 5);
    });
});
