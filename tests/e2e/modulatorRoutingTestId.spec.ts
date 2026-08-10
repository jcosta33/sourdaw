import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

// Automation/modulation routing depth: the matrix's primary purpose is routing
// a modulator to a device parameter with an amount. Existing specs cover
// modulator CREATION (card appears, empty state cleared) but not the routing —
// no spec adds a mapping and asserts the destination row + amount. This spec
// creates an LFO modulator, routes it to a synth parameter, and asserts the
// MappingRow renders with the resolved destination and a working amount.
async function open_dock_tab(page: import('@playwright/test').Page, tabId: string): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
    if (!/true/i.test((await toggle.getAttribute('aria-pressed')) ?? '')) {
        await toggle.click();
    }
    await page.locator(`#bottom-dock-tab-${tabId}`).click();
    await page.waitForTimeout(400);
}

test.describe('Modulation routing — modulator to parameter with amount', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        // EDM template ships a Fermenter synth track, so a device with
        // automatable parameters exists without further setup.
        await launch_from_template({ page, template_name: /EDM/i });
        await open_dock_tab(page, 'modulation');
    });

    test('creating an LFO and routing it to a parameter renders the mapping with an amount', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });

        // Create an LFO modulator. The EDM template ships tracks, so the
        // Modulator track scope defaults and the form's Add button is enabled.
        await expect(matrix.getByText('No modulators')).toBeVisible();
        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        await matrix.getByRole('textbox', { name: 'Modulator name' }).fill('Route LFO');
        await matrix.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(matrix.getByText('No modulators')).toHaveCount(0);

        // Open the Add Mapping picker on the new modulator card.
        await matrix.getByRole('button', { name: /Add Mapping/i }).first().click();
        const targetTrack = matrix.getByRole('combobox', { name: 'Target track' });
        await expect(targetTrack).toBeVisible({ timeout: 5000 });
        // Pick the first real track so device + parameter resolve.
        const firstTrackValue = await targetTrack.locator('option').filter({ hasText: /.+/ }).nth(1).getAttribute('value');
        if (firstTrackValue) {
            await targetTrack.selectOption(firstTrackValue);
        }

        // The picker's Add (secondary button with a Plus icon) commits the
        // mapping once target track/device/parameter all resolve.
        const pickerAdd = matrix.getByRole('button', { name: 'Add', exact: true }).first();
        await expect(pickerAdd).toBeEnabled({ timeout: 5000 });
        await pickerAdd.click();

        // A MappingRow now renders with an amount range input whose aria-label
        // names the source→destination route. Moving it changes the value — the
        // routing carries a real, adjustable depth, not a static row. Native
        // range inputs expose their value via .value, not aria-valuenow.
        const amount = matrix.getByRole('slider', { name: /Amount for .* to .*/i }).first();
        await expect(amount).toBeVisible({ timeout: 5000 });
        const amountBefore = Number(await amount.inputValue());
        await amount.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const amountAfter = Number(await amount.inputValue());
        expect(amountAfter).not.toBe(amountBefore);
    });
});
