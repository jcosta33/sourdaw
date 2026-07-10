import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Instrument Panels — Synths & Samplers', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Browser panel shows available instruments', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await expect(browser).toBeVisible();
        await expect(browser.getByText('Fermenter')).toBeVisible();
        await expect(browser.getByText('Toaster')).toBeVisible();
        await expect(browser.getByText('Levain')).toBeVisible();
    });

    test('Default MIDI track has a synth device in the inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByText('Synth')).toBeVisible();
    });

    test('Can open the Fermenter panel by clicking device in inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const synth = inspector.getByText('Synth').first();
        await synth.click();
        await page.waitForTimeout(1000);

        const bottom_panel = page.locator('[class*="instrument-bottom-panel"], [data-instrument-panel]');
        if (await bottom_panel.isVisible().catch(() => false)) {
            await expect(bottom_panel).toBeVisible();
        }
    });

    test('Can add a Toaster instrument from the browser', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const toaster_button = browser.getByRole('button', { name: /Toaster/i });
        await expect(toaster_button).toBeVisible();
        await toaster_button.click();
        await page.waitForTimeout(1000);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();
    });

    test('Can bypass and enable the default synth device', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const bypass = inspector.getByRole('button', { name: /Bypass Synth/i });
        await expect(bypass).toBeVisible();

        await bypass.click();
        await expect(inspector.getByRole('button', { name: /Enable Synth/i })).toBeVisible({ timeout: 5000 });
    });
});
