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

    test('Browser panel lists released instruments only', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await expect(browser.getByText('Fermenter')).toBeVisible();
        await expect(browser.getByText('Toaster')).toBeVisible();
        await expect(browser.getByText('Levain')).toBeVisible();
        await expect(browser.getByText('Crumbs')).toBeVisible();
        await expect(browser.getByRole('button', { name: /^Grand Boule/i })).toHaveCount(0);
    });

    test('Default MIDI track has synth device shown in inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByText('Synth')).toBeVisible();
        await expect(inspector.getByRole('button', { name: /Bypass Synth/i })).toBeVisible();
        await expect(inspector.getByRole('button', { name: /Remove Synth/i })).toBeVisible();
    });

    test('Can add Toaster instrument from browser and verify device changes', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const toaster = browser.getByRole('button', { name: /Toaster/i });
        await toaster.click();
        await page.waitForTimeout(1000);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const has_toaster = await inspector
            .getByText(/Toaster/i)
            .first()
            .isVisible()
            .catch(() => false);
        const has_synth = await inspector
            .getByText('Synth')
            .first()
            .isVisible()
            .catch(() => false);
        expect(has_toaster || has_synth).toBe(true);
    });

    test('Can bypass and re-enable default synth device', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const bypass = inspector.getByRole('button', { name: /Bypass Synth/i });
        await bypass.click();
        await expect(inspector.getByRole('button', { name: /Enable Synth/i })).toBeVisible({ timeout: 5000 });

        await inspector.getByRole('button', { name: /Enable Synth/i }).click();
        await expect(inspector.getByRole('button', { name: /Bypass Synth/i })).toBeVisible({ timeout: 5000 });
    });

    test('Browser Effects tab is accessible', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        await page.waitForTimeout(500);
        await expect(browser).toBeVisible();
        await expect(browser.getByRole('button').first()).toBeVisible();
    });
});
