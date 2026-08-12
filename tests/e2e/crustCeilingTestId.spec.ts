import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// The Crust limiter's "Output ceiling in dBTP" number input (CrustPanel footer)
// had no E2E coverage. It is a controlled <input type="number"> bound to
// `patch.ceiling`; typing a new value runs handleSetParam('ceiling', n) which
// commits through the store and the controlled value reflects the change.
test.describe('Crust limiter ceiling — number input value change', () => {
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

        // Open the panel by clicking the device card text.
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('typing a new ceiling value updates the input', async ({ page }) => {
        const ceiling = page.getByLabel('Output ceiling in dBTP');

        // The panel mounted with the ceiling number input present.
        await expect(ceiling).toBeVisible({ timeout: 15_000 });

        // Read the committed value before editing.
        const before = await ceiling.inputValue();

        // Type a new value within the -6..0 dBTP range and let it commit.
        await ceiling.fill('-2');
        await expect(ceiling).toHaveValue('-2');

        // The committed value changed away from the original.
        const after = await ceiling.inputValue();
        expect(after).not.toBe(before);
        expect(Number(after)).toBe(-2);
    });
});
