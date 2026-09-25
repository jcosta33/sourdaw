import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const EXPECTED_BROWSER_INSTRUMENT_CARDS = ['Fermenter', 'Toaster', 'Levain', 'Grand Boule'] as const;

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
        await expect(playDoughCards.getByRole('button', { name: /^Crumbs\b/i })).toHaveCount(0);
    });

    test('Default MIDI track has synth device shown in inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        // The rack card is the device's stable handle. `getByText('Synth')` also
        // matched the track-role `<option value="synth">` rendered above the
        // rack, which is why this reads the card and its own controls.
        const device_cards = inspector.locator('[data-testid^="device-card-"]');
        await expect(device_cards).toHaveCount(1);
        await expect(device_cards.filter({ hasText: 'Synth' })).toBeVisible();
        await expect(inspector.getByRole('button', { name: /Bypass Synth/i })).toBeVisible();
        await expect(inspector.getByRole('button', { name: /Remove Synth/i })).toBeVisible();
    });

    test('Can add Toaster instrument from browser and verify device changes', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const device_cards = inspector.locator('[data-testid^="device-card-"]');
        const toaster_card = device_cards.filter({ hasText: 'Toaster' });
        // Before the click the selected MIDI track's rack holds the Synth only.
        await expect(toaster_card).toHaveCount(0);

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const toaster = browser.getByRole('button', { name: /Toaster/i });
        await toaster.click();

        // Toaster Kit creation selects the new track, so its rack card is the
        // post-click state: the case fails when nothing was added rather than
        // passing on the Synth device that was already there.
        await expect(toaster_card).toHaveCount(1, { timeout: 15_000 });
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
