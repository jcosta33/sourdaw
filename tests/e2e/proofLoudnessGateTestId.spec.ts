import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof module limiter's true-peak ceiling knob (aria-label="Limiter ceiling",
// rendered by ProofLimiterSection in the Level 3 "Build" desk depth). The other
// two ceiling knobs over the same patch.limCeiling param are already covered —
// proofMissionCeilingTestId (Level 1 "Target desk") and proofLimiterCeilingTestId
// (the always-visible Check SideCard "Master limiter ceiling") — so this spec
// needs exact: true to disambiguate. Asserts the knob mounts as role="slider"
// and responds to ArrowUp by raising aria-valuenow, the same keyboard contract
// those siblings assert.
test.describe('Proof limiter section true-peak ceiling — keyboard response', () => {
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
        await inspector.getByText('Proof', { exact: false }).first().click();
        await expect(page.getByRole('slider', { name: 'Mission limiter ceiling' })).toBeVisible({
            timeout: 15_000,
        });

        // Descend to the Level 3 "Build" desk depth where ProofLimiterSection lives.
        await page.getByRole('button', { name: 'Build Modules', exact: true }).click();
        await expect(
            page.getByRole('slider', { name: 'Limiter ceiling', exact: true })
        ).toBeVisible({ timeout: 15_000 });
    });

    test('ArrowUp increments aria-valuenow', async ({ page }) => {
        const ceiling = page.getByRole('slider', { name: 'Limiter ceiling', exact: true }).first();
        await ceiling.focus();

        const before = Number(await ceiling.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await ceiling.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
