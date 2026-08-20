import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
}

async function addDeviceAndOpenPanel(page: Page, device: string): Promise<void> {
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Add device' }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${device}$`) }).click();
    await expect(inspector.getByRole('button', { name: new RegExp(`^Bypass ${device}$`, 'i') })).toBeVisible();
    await inspector.getByText(device, { exact: true }).first().click();
    await expect(page.getByRole('button', { name: `Close ${device}` })).toBeVisible();
}

async function closePanel(page: Page, device: string): Promise<void> {
    const closePanelButton = page.getByRole('button', { name: `Close ${device}` });
    // Bacteria's faceplate paints over the chrome and intercepts pointer clicks;
    // the control is still keyboard-operable via its aria-label.
    await closePanelButton.focus();
    await page.keyboard.press('Enter');
    await expect(closePanelButton).toHaveCount(0);
}

test.describe('All device panels — open, verify, close', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('Gluten compressor panel opens and closes', async ({ page }) => {
        await addDeviceAndOpenPanel(page, 'Gluten');
        await expect(page.getByRole('slider', { name: 'Threshold' })).toBeVisible();
        await closePanel(page, 'Gluten');
    });

    test('Bacteria FX panel opens and closes', async ({ page }) => {
        await addDeviceAndOpenPanel(page, 'Bacteria');
        await expect(page.getByLabel('Search Bacteria presets')).toBeVisible();
        await closePanel(page, 'Bacteria');
    });

    test('Dutch Oven reverb panel opens', async ({ page }) => {
        await addDeviceAndOpenPanel(page, 'Dutch Oven');
        await expect(page.getByRole('slider', { name: 'Decay' })).toBeVisible();
        await closePanel(page, 'Dutch Oven');
    });

    test('Crust limiter panel opens', async ({ page }) => {
        await addDeviceAndOpenPanel(page, 'Crust');
        await expect(page.getByRole('button', { name: 'True peak', exact: true })).toBeVisible();
        await closePanel(page, 'Crust');
    });

    test('Grinder amp panel opens', async ({ page }) => {
        await addDeviceAndOpenPanel(page, 'Grinder');
        await expect(page.getByLabel('Search Grinder presets')).toBeVisible();
        await closePanel(page, 'Grinder');
    });
});
