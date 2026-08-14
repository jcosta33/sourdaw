import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

// The Add Mapping picker has three cascade selects: Target track (already
// driven by modulatorRoutingTestId.spec.ts), plus Target device and Target
// parameter, which that spec leaves at their defaults (first device, first
// automatable param). This spec explicitly drives the device and parameter
// comboboxes and asserts the committed MappingRow names the selected
// destination — proving the cascade resets and the explicit selections carry
// through addMapping. It also drives the New Modulator form's LFO waveform
// select, which no spec had touched.
async function open_dock_tab(page: import('@playwright/test').Page, tabId: string): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
    if (!/true/i.test((await toggle.getAttribute('aria-pressed')) ?? '')) {
        await toggle.click();
    }
    await page.locator(`#bottom-dock-tab-${tabId}`).click();
    await page.waitForTimeout(400);
}

test.describe('Modulation picker — explicit target device/parameter and LFO waveform selects', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        // The EDM template's Bass track ships two devices (Sub Bass + Bass EQ)
        // and the EQ has many automatable params, so both cascading selects
        // have a non-default option to pick.
        await launch_from_template({ page, template_name: /EDM/i });
        await open_dock_tab(page, 'modulation');
    });

    test('explicit Target device and Target parameter selections carry into the mapping row', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });

        // Create an LFO modulator (track scope defaults to the first track).
        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        await matrix.getByRole('textbox', { name: 'Modulator name' }).fill('Deep Route');
        await matrix.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(matrix.getByText('No modulators')).toHaveCount(0);

        // Open the Add Mapping picker and pick the Bass track explicitly.
        await matrix
            .getByRole('button', { name: /Add Mapping/i })
            .first()
            .click();
        const targetTrack = matrix.getByRole('combobox', { name: 'Target track' });
        await expect(targetTrack).toBeVisible({ timeout: 5000 });
        await targetTrack.selectOption({ label: 'Bass' });

        // Target device defaults to the track's first device (Sub Bass).
        // Selecting Bass EQ must change the value and cascade-reset the
        // parameter select to the EQ's first automatable param.
        const targetDevice = matrix.getByRole('combobox', { name: 'Target device' });
        await expect(targetDevice).toBeEnabled({ timeout: 5000 });
        const deviceBefore = await targetDevice.inputValue();
        await targetDevice.selectOption({ label: 'Bass EQ' });
        const deviceAfter = await targetDevice.inputValue();
        expect(deviceAfter).not.toBe(deviceBefore);

        // Target parameter is now the EQ's first automatable param (Low Gain).
        // Selecting a different param must change the value.
        const targetParam = matrix.getByRole('combobox', { name: 'Target parameter' });
        await expect(targetParam).toBeEnabled({ timeout: 5000 });
        const paramBefore = await targetParam.inputValue();
        await targetParam.selectOption({ label: 'Mid Freq' });
        const paramAfter = await targetParam.inputValue();
        expect(paramAfter).not.toBe(paramBefore);

        // Commit the mapping with the explicit selections.
        const pickerAdd = matrix.getByRole('button', { name: 'Add', exact: true }).first();
        await expect(pickerAdd).toBeEnabled({ timeout: 5000 });
        await pickerAdd.click();

        // The MappingRow's destination must name the explicitly selected
        // track · device · parameter, not the first-of-each defaults.
        const destination = matrix.getByText('Bass · Bass EQ · Mid Freq');
        await expect(destination).toBeVisible({ timeout: 5000 });
        await expect(
            matrix.getByRole('slider', { name: /Amount for Deep Route · LFO to Bass · Bass EQ · Mid Freq/i })
        ).toBeVisible();
    });

    test('LFO waveform select reflects an explicit non-default selection', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });

        await matrix.getByRole('button', { name: 'New Modulator', exact: true }).click();
        const waveform = matrix.getByRole('combobox', { name: 'LFO waveform' });
        await expect(waveform).toBeVisible({ timeout: 5000 });
        // Default form ships sine; the select must accept and hold a
        // different waveform before the modulator is committed.
        expect(await waveform.inputValue()).toBe('sine');
        await waveform.selectOption('square');
        expect(await waveform.inputValue()).toBe('square');
    });
});
