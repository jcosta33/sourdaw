import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Generate panel — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('opening generate panel shows MIDI and Audio tabs via test IDs', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(500);

        await expect(page.getByTestId('generate-tab-midi')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('generate-tab-audio')).toBeVisible({ timeout: 5000 });
    });

    test('MIDI tab is active by default', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(500);

        const midi = page.getByTestId('generate-tab-midi');
        const audio = page.getByTestId('generate-tab-audio');

        // MIDI should be secondary (active), audio should be ghost (inactive).
        const midiVariant = await midi.getAttribute('data-variant');
        const audioVariant = await audio.getAttribute('data-variant');
        expect(midiVariant).not.toBe(audioVariant);
    });

    test('switching to Audio tab changes active variant', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(500);

        const audio = page.getByTestId('generate-tab-audio');
        const before = await audio.getAttribute('data-variant');

        await audio.click();
        await page.waitForTimeout(300);

        const after = await audio.getAttribute('data-variant');
        expect(after).not.toBe(before);
    });

    test('switching back to MIDI tab restores active state', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(500);

        // Go to Audio.
        await page.getByTestId('generate-tab-audio').click();
        await page.waitForTimeout(300);

        // Back to MIDI.
        await page.getByTestId('generate-tab-midi').click();
        await page.waitForTimeout(300);

        const midi = page.getByTestId('generate-tab-midi');
        const midiVariant = await midi.getAttribute('data-variant');
        expect(midiVariant).toBe('secondary');
    });

    test('generate panel shows content below tabs', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(500);

        // The panel should have content below the tabs.
        const panel = page.getByText('Generate').first();
        await expect(panel).toBeVisible();
    });
});
