import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ProofChamber tail/tone knobs: Size (#1641), Decay+Mix (#1706), Pre (later)
// covered the Core card. The Tone card's Hi Cut / Lo Cut / Damp and the
// Character card's Gravity — the sliders behind the "High cut" / "Low cut" /
// "Damping" / "Gravity" Quick read rows — were still uncovered. The default
// plate algorithm has no rows in NATIVE_DSP_ENGINE_GAPS, so all four knobs are
// live without selecting a space; the gap table only disables them on
// fdn/spring/reverse.
test.describe('ProofChamber tail knobs — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Dutch Oven$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Dutch Oven$/i })).toBeVisible();

        // Open the panel by clicking the device card text.
        await inspector.getByText('Dutch Oven', { exact: false }).first().click();
        await expect(page.getByRole('slider', { name: 'Size' })).toBeVisible({ timeout: 15_000 });
    });

    test('Hi Cut knob responds to keyboard', async ({ page }) => {
        const hiCut = page.getByRole('slider', { name: 'Hi Cut' }).first();
        await expect(hiCut).toBeVisible({ timeout: 5000 });
        await hiCut.focus();
        const before = Number(await hiCut.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await hiCut.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Lo Cut knob responds to keyboard', async ({ page }) => {
        const loCut = page.getByRole('slider', { name: 'Lo Cut' }).first();
        await expect(loCut).toBeVisible({ timeout: 5000 });
        await loCut.focus();
        const before = Number(await loCut.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await loCut.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Damp knob responds to keyboard', async ({ page }) => {
        const damp = page.getByRole('slider', { name: 'Damp' }).first();
        await expect(damp).toBeVisible({ timeout: 5000 });
        await damp.focus();
        const before = Number(await damp.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await damp.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    // Gravity is bipolar (-1..1, step 0.01, default 0.5). RotaryKnob's clamp
    // snaps values within (max-min)*0.01 of the default back to the default, so
    // a single 0.01 arrow step from 0.5 is swallowed and the knob cannot leave
    // its default by repeated ArrowUp alone. Home first jumps to min (-1), far
    // outside the snap zone, so ArrowUp then proves the keyboard wiring — the
    // same "floor it first" shape deviceKnobKeyboardTestId.spec.ts uses.
    test('Gravity knob responds to keyboard', async ({ page }) => {
        const gravity = page.getByRole('slider', { name: 'Gravity' }).first();
        await expect(gravity).toBeVisible({ timeout: 5000 });
        await gravity.focus();
        await page.keyboard.press('Home');
        await page.waitForTimeout(200);
        const before = Number(await gravity.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gravity.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
