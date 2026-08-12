import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof "Mission limiter ceiling" knob: lives in the Level 1 "Target desk"
// view, which is the default uiLevel when the panel mounts. Uncovered by no
// prior E2E — this asserts the knob mounts as a role="slider" and responds to
// ArrowUp by raising aria-valuenow, the same contract deviceKnobKeyboardTestId
// asserts for Gluten and proofLimiterCeilingTestId asserts for the Check
// SideCard's "Master limiter ceiling".
test.describe('Proof mission limiter ceiling — keyboard response', () => {
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
    });

    test('ArrowUp increments aria-valuenow', async ({ page }) => {
        const ceiling = page.getByRole('slider', { name: 'Mission limiter ceiling' }).first();
        await ceiling.focus();

        const before = Number(await ceiling.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await ceiling.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
