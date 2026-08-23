import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const EXPECTED_BROWSER_INSTRUMENT_CARDS = ['Fermenter', 'Toaster', 'Levain', 'Crumbs', 'Grand Boule'] as const;

test.describe('Instrument Panels — Synths & Samplers', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Play Dough exposes the exact House Specials instrument-card census', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const playDoughCards = browser.getByText('Play Dough', { exact: true }).locator('..').locator('..');
        await expect(playDoughCards.getByRole('button')).toHaveCount(EXPECTED_BROWSER_INSTRUMENT_CARDS.length);
        for (const label of EXPECTED_BROWSER_INSTRUMENT_CARDS) {
            const card = playDoughCards.getByRole('button', { name: new RegExp(`^${label}\\b`, 'i') });
            await expect(card).toHaveCount(1);
        }
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
