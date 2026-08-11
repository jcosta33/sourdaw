import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust preset selector: the preset dropdown loads a factory preset patch.
// Selecting a different preset changes the patch name (observable as the
// preset button's label text). No E2E covers this.
test.describe('Crust preset selection — patch name changes', () => {
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

    test('selecting a different preset changes the patch name readout', async ({ page }) => {
        // The preset button is the one with aria-haspopup="listbox" that also
        // contains the preset name (NOT the streaming-target one).
        // The preset dropdown trigger shows the current patch name.
        const presetTrigger = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Crust presets/i }).first();
        // If the trigger isn't found by that filter, try the first listbox button.
        const trigger = (await presetTrigger.count()) > 0
            ? presetTrigger
            : page.locator('button[aria-haspopup="listbox"]').first();
        await expect(trigger).toBeVisible({ timeout: 5000 });
        const nameBefore = (await trigger.innerText()).trim();

        // Open the preset listbox.
        await trigger.click();
        await page.waitForTimeout(300);

        const listbox = page.getByRole('listbox', { name: 'Crust presets' });
        await expect(listbox).toBeVisible({ timeout: 5000 });

        // Select the first option whose title differs from the current name.
        const options = listbox.getByRole('option');
        const optCount = await options.count();
        expect(optCount).toBeGreaterThanOrEqual(2);

        let selected = false;
        for (let i = 0; i < optCount && !selected; i += 1) {
            const opt = options.nth(i);
            const isActive = await opt.getAttribute('aria-selected');
            if (isActive !== 'true') {
                await opt.click();
                await page.waitForTimeout(400);
                selected = true;
            }
        }
        expect(selected).toBe(true);

        // The trigger's text changed — a real preset swap.
        const nameAfter = (await trigger.innerText()).trim();
        expect(nameAfter).not.toBe(nameBefore);
    });
});
