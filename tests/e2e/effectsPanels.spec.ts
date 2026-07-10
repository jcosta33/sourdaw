import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_device(page: import('@playwright/test').Page, name: RegExp): Promise<void> {
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Add device' }).click();
    await page.getByRole('menuitem', { name: name }).click();
    await expect(inspector.getByText(name)).toBeVisible({ timeout: 5000 });
}

test.describe('Instrument Panels — Effects', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Can add a Gluten compressor to the chain', async ({ page }) => {
        await add_device(page, /Gluten/i);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByRole('button', { name: /Bypass Gluten/i })).toBeVisible();
    });

    test('Can add a Bacteria multi-FX to the chain', async ({ page }) => {
        await add_device(page, /Bacteria/i);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByRole('button', { name: /Bypass Bacteria/i })).toBeVisible();
    });

    test('Can add a Grinder amp to the chain', async ({ page }) => {
        await add_device(page, /Grinder/i);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByRole('button', { name: /Bypass Grinder/i })).toBeVisible();
    });

    test('Can add Proof mastering suite to the chain', async ({ page }) => {
        await add_device(page, /Proof/i);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByText(/Proof/i)).toBeVisible({ timeout: 5000 });
    });

    test('Can remove a device from the chain', async ({ page }) => {
        await add_device(page, /Gluten/i);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        const remove = inspector.getByRole('button', { name: /Remove Gluten/i });
        await remove.click();
        await page.waitForTimeout(500);

        await expect(inspector.getByText(/Gluten/i)).toHaveCount(0);
    });

    test('Can bypass and re-enable a device', async ({ page }) => {
        await add_device(page, /Gluten/i);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        const bypass = inspector.getByRole('button', { name: /Bypass Gluten/i });
        await bypass.click();
        await expect(inspector.getByRole('button', { name: /Enable Gluten/i })).toBeVisible({ timeout: 5000 });

        await inspector.getByRole('button', { name: /Enable Gluten/i }).click();
        await expect(inspector.getByRole('button', { name: /Bypass Gluten/i })).toBeVisible({ timeout: 5000 });
    });
});
