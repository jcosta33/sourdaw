import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof's Build desk (Level 3) multiband Dynamics section (ProofDynSection)
// renders 4 bands (Sub, Low-Mid, Hi-Mid, High), each with threshold / ratio /
// attack / release RotaryKnobs plus three crossover frequency knobs. None were
// covered by prior E2E. This asserts the per-band threshold and ratio knobs
// mount as role="slider" and respond to ArrowUp by raising aria-valuenow —
// the same keyboard contract proofLimiterCeilingTestId asserts for the
// always-visible Check desk knob.
test.describe('Proof Build dynamics band knobs — keyboard response', () => {
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
        // where the multiband Dynamics section renders.
        await page.getByRole('button', { name: 'Build Modules' }).click();

        // Gate on the section itself before asserting knob behaviour.
        await expect(
            page.getByRole('button', { name: 'Dynamics module' })
        ).toBeVisible({ timeout: 15_000 });
    });

    test('ArrowUp raises a Dynamics band threshold slider', async ({ page }) => {
        const threshold = page.getByRole('slider', { name: /Dynamics .* threshold/i }).first();
        await expect(threshold).toBeVisible();
        await threshold.focus();

        const before = Number(await threshold.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await threshold.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('ArrowUp raises a Dynamics band ratio slider', async ({ page }) => {
        const ratio = page.getByRole('slider', { name: /Dynamics .* ratio/i }).first();
        await expect(ratio).toBeVisible();
        await ratio.focus();

        const before = Number(await ratio.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await ratio.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
