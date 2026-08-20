import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
    await trackList
        .getByRole('row')
        .filter({ has: page.getByText('MIDI', { exact: true }) })
        .first()
        .click();
}

function inspector(page: Page) {
    return page.getByRole('complementary', { name: 'Inspector panel' });
}

async function addGluten(page: Page): Promise<void> {
    const panel = inspector(page);
    await panel.getByRole('button', { name: 'Add device' }).click();
    await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
    await expect(panel.getByRole('button', { name: /^Bypass Gluten$/i })).toBeVisible();
}

test.describe('Device chain — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('add device button is present in the inspector via test ID', async ({ page }) => {
        const addDevice = inspector(page).getByRole('button', { name: 'Add device' });
        await expect(addDevice).toBeVisible();
        await expect(addDevice).toHaveAttribute('data-testid', 'add-device-button');
    });

    test('clicking add device opens a menu with Gluten', async ({ page }) => {
        const addDevice = inspector(page).getByRole('button', { name: 'Add device' });
        await expect(page.getByRole('menuitem', { name: /^Gluten$/ })).toHaveCount(0);

        await addDevice.click();

        await expect(page.getByRole('menu')).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /^Gluten$/ })).toBeVisible();
    });

    test('adding Gluten creates a device card', async ({ page }) => {
        const panel = inspector(page);
        await expect(panel.getByRole('button', { name: /^Bypass Gluten$/i })).toHaveCount(0);

        await addGluten(page);

        await expect(panel.getByText('Gluten', { exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: /^Remove Gluten$/i })).toBeVisible();
    });

    test('bypass toggle on Gluten changes aria-pressed', async ({ page }) => {
        const panel = inspector(page);
        await addGluten(page);

        const bypass = panel.getByRole('button', { name: /^Bypass Gluten$/i });
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');
        await expect(bypass).toHaveAttribute('data-testid', /^device-bypass-/);

        await bypass.click();
        const enable = panel.getByRole('button', { name: /^Enable Gluten$/i });
        await expect(enable).toBeVisible();
        await expect(enable).toHaveAttribute('aria-pressed', 'true');

        await enable.click();
        await expect(panel.getByRole('button', { name: /^Bypass Gluten$/i })).toHaveAttribute('aria-pressed', 'false');
    });

    test('removing Gluten removes the device card', async ({ page }) => {
        const panel = inspector(page);
        await addGluten(page);
        await expect(panel.getByRole('button', { name: /^Bypass Gluten$/i })).toBeVisible();

        await panel.getByRole('button', { name: /^Remove Gluten$/i }).click();

        await expect(panel.getByRole('button', { name: /^Bypass Gluten$/i })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: /^Remove Gluten$/i })).toHaveCount(0);
    });
});
