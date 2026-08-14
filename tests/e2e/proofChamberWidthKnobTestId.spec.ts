import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ProofChamber (Dutch Oven) parameter matrix: Size (#1641), Decay, and Mix are
// covered. The Width knob — the stereo spread control in the Motion section —
// is not. Same open path: add Dutch Oven via inspector, panel mounts with the
// control deck knobs.
test.describe('ProofChamber Width knob — keyboard response', () => {
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

    test('Width knob responds to keyboard', async ({ page }) => {
        const width = page.getByRole('slider', { name: 'Width' }).first();
        await expect(width).toBeVisible({ timeout: 5000 });
        await width.focus();
        const before = Number(await width.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await width.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
