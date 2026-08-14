import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ProofImagerSection renders 4 per-band width RotaryKnobs (aria-labels
// "Imager <band> width") plus an auto-mono-bass frequency knob; ProofExciterSection
// renders per-band drive/blend knobs (aria-labels "Exciter <band> drive|blend").
// None were covered by E2E before this spec (EQ is covered by proofEqKnobsTestId,
// Dynamics by proofDynKnobsTestId). Each test focuses a knob, presses ArrowUp, and
// asserts aria-valuenow increased — the same slider contract those specs assert.
test.describe('Proof Build imager/exciter knobs — keyboard response', () => {
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
        // where the Imager and Exciter knobs render.
        await page.getByRole('button', { name: 'Build Modules' }).click();
        await expect(page.getByRole('slider', { name: /Imager .* width/i }).first()).toBeVisible({
            timeout: 15_000,
        });
    });

    test('ArrowUp raises the Imager Low-Mid width knob aria-valuenow', async ({ page }) => {
        const width = page.getByRole('slider', { name: 'Imager Low-Mid width' });
        await width.focus();

        const before = Number(await width.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await width.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('ArrowUp raises the Exciter Hi-Mid drive knob aria-valuenow', async ({ page }) => {
        const drive = page.getByRole('slider', { name: 'Exciter Hi-Mid drive' });
        await drive.focus();

        const before = Number(await drive.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await drive.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
