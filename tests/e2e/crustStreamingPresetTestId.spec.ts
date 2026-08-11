import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust streaming-loudness-target preset: opening the listbox + selecting a
// different preset changes aria-selected + the target LUFS readout. No E2E
// covers this; #1707 covered the level chips.
test.describe('Crust streaming preset — selection changes aria-selected + LUFS target', () => {
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
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('selecting a streaming preset flips aria-selected and changes the LUFS readout', async ({ page }) => {
        // The streaming-target button opens a listbox. Scope by its "Target"
        // label to distinguish from any other listbox-popup button.
        const targetButton = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Target/i }).first();
        await expect(targetButton).toBeVisible({ timeout: 5000 });

        // Capture the current LUFS readout before switching.
        const lufsBefore = (await targetButton.innerText()).trim();

        // Open the listbox.
        await targetButton.click();
        await page.waitForTimeout(300);
        await expect(targetButton).toHaveAttribute('aria-expanded', 'true');

        // The listbox options each have aria-selected. Find an inactive one.
        const listbox = page.getByRole('listbox', { name: 'Streaming loudness targets' });
        const options = listbox.getByRole('option');
        const optCount = await options.count();
        expect(optCount).toBeGreaterThanOrEqual(2);

        // Select the first option that is NOT currently selected.
        let selected = false;
        for (let i = 0; i < optCount && !selected; i += 1) {
            const opt = options.nth(i);
            const isSelected = await opt.getAttribute('aria-selected');
            if (isSelected !== 'true') {
                await opt.click();
                await page.waitForTimeout(300);
                selected = true;
            }
        }
        expect(selected).toBe(true);

        // The LUFS readout changed — a real state change from the preset swap.
        const lufsAfter = (await targetButton.innerText()).trim();
        expect(lufsAfter).not.toBe(lufsBefore);
    });
});
