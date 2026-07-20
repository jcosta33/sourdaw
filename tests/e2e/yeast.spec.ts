import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Yeast (MIDI FX rack) is not in the inspector's "Add device" menu — it's a
 * premium card surfaced under Browser panel -> Effects -> MIDI FX, and
 * requires a selected track (it attaches to whichever track is selected).
 * Opens the panel and returns once its close control is visible.
 */
async function open_yeast_panel(page: import('@playwright/test').Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();

    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: 'MIDI FX' }).click();

    const yeastCard = browser.getByRole('button', { name: 'Yeast' });
    await yeastCard.waitFor({ state: 'visible' });
    await yeastCard.click();

    await expect(page.getByRole('button', { name: 'Close Yeast' })).toBeVisible();
}

test.describe('Yeast (MIDI FX rack panel)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Opening Yeast renders the Play deck with no processors loaded yet', async ({ page }) => {
        await open_yeast_panel(page);

        const arpToggle = page.getByRole('button', { name: /^Arp (On|Off)$/ });
        await expect(arpToggle).toHaveText('Arp Off');
        await expect(arpToggle).toHaveAttribute('aria-pressed', 'false');

        const rackRead = page.locator('section').filter({ hasText: 'Rack read' });
        await expect(rackRead.getByText('No processors yet.')).toBeVisible();
    });

    test('Adding the arpeggiator from the sprout shelf lights it up as a live rack processor', async ({ page }) => {
        await open_yeast_panel(page);

        const rackRead = page.locator('section').filter({ hasText: 'Rack read' });
        await expect(rackRead.getByText('No processors yet.')).toBeVisible();

        // The Play deck's "Arp On/Off" toggle mirrors the same processor list,
        // so the sprout shelf's "+ Arpeggiator" chip is a second, independent
        // control surface for the same state — driving it here proves the
        // rack (not just one button) reacts to a real interaction.
        await page.getByRole('button', { name: '+ Arpeggiator' }).click();

        await expect(rackRead.getByText('No processors yet.')).not.toBeVisible();
        // Exact + case-sensitive: the rack row also renders the processor's
        // lowercase `type` field ("arpeggiator") right below its name.
        await expect(rackRead.getByText('Arpeggiator', { exact: true })).toBeVisible();
        await expect(rackRead.getByText('Live')).toBeVisible();

        // The Play deck's toggle reflects the same processors list, confirming
        // the state change is store-wide rather than local to the shelf chip.
        const arpToggle = page.getByRole('button', { name: /^Arp (On|Off)$/ });
        await expect(arpToggle).toHaveText('Arp On');
        await expect(arpToggle).toHaveAttribute('aria-pressed', 'true');
    });
});
