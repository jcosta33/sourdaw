import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust (limiter) level chips: L1-L5 switch the panel's detail level. The chip's
// active state flips (aria-pressed) on selection — a real state change. No E2E
// covers this; #1632 only asserts the device-add count delta.
test.describe('Crust level chips — switching detail level flips aria-pressed', () => {
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

        // Open the panel.
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('selecting L1 flips its chip aria-pressed true and clears L2', async ({ page }) => {
        const l1 = page.getByRole('button', { name: 'L1', exact: true });
        const l2 = page.getByRole('button', { name: 'L2', exact: true });

        // L2 is the default detail level (DEFAULT_CRUST_PATCH.uiLevel = 2).
        await expect(l2).toHaveAttribute('aria-pressed', 'true');

        // Switch to L1.
        await l1.click();
        await page.waitForTimeout(300);

        // L1 is now active; L2 is not.
        await expect(l1).toHaveAttribute('aria-pressed', 'true');
        await expect(l2).not.toHaveAttribute('aria-pressed', 'true');
    });
});
