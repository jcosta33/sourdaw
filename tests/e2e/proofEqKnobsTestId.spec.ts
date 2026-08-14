import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ProofEqSection renders 8 EQ bands, each with RotaryKnob sliders for
// frequency / gain / Q (aria-labels "EQ <band> frequency|gain|Q"). None were
// covered by E2E before this spec. Each test focuses a knob, presses ArrowUp,
// and asserts aria-valuenow increased — the same slider contract
// proofLimiterCeilingTestId asserts for the Check-desk limiter ceiling knob.
test.describe('Proof Build EQ band knobs — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();

        // Open the panel by clicking the device card text.
        await inspector.getByText('Proof', { exact: false }).first().click();
        await expect(page.getByRole('button', { name: /reset loudness/i })).toBeVisible({
            timeout: 15_000,
        });

        // The panel mounts at desk depth 1 (Play). Drop to depth 3 (Build)
        // where the EQ band knobs render.
        await page.getByRole('button', { name: 'Build Modules' }).click();
        await expect(page.getByRole('slider', { name: /EQ .* gain/i }).first()).toBeVisible({
            timeout: 15_000,
        });
    });

    test('ArrowUp raises the first EQ gain knob aria-valuenow', async ({ page }) => {
        const gain = page.getByRole('slider', { name: /EQ .* gain/i }).first();
        await gain.focus();

        const before = Number(await gain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await gain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('ArrowUp raises the first EQ frequency knob aria-valuenow', async ({ page }) => {
        const frequency = page.getByRole('slider', { name: /EQ .* frequency/i }).first();
        await frequency.focus();

        const before = Number(await frequency.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await frequency.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
