import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Opens the Scoring (Tuner) device panel on a fresh Audio track. Mirrors the
 * device-expansion flow in tuner.spec.ts (Add audio -> Add device -> Scoring ->
 * double-click card -> panel opens).
 */
async function open_scoring_panel(page: import('@playwright/test').Page): Promise<void> {
    const addAudioButton = page
        .locator('button')
        .filter({ hasText: 'Audio' })
        .filter({ hasText: 'Record or import' });
    await addAudioButton.waitFor({ state: 'visible' });
    await addAudioButton.click();

    const addDeviceButton = page.getByLabel('Add device');
    await expect(addDeviceButton).toBeVisible();
    await addDeviceButton.click();

    const scoringItem = page.getByRole('menuitem', { name: /Scoring/i });
    await scoringItem.waitFor({ state: 'visible' });
    await scoringItem.click();

    const scoringCard = page.getByText('Scoring', { exact: true });
    await scoringCard.dblclick();

    await expect(page.getByRole('button', { name: 'Close Scoring' })).toBeVisible();
}

test.describe('Tuner (Scoring A4 reference knob keyboard bounds)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Home jumps the A4 reference to its minimum and End to its maximum', async ({ page }) => {
        await open_scoring_panel(page);

        // The reference knob exposes its bounds as ARIA slider attributes; the
        // descriptor pins a4_hz to [400, 490] with a 440 default, so neither
        // bound is the resting value and each keypress is a real move.
        const referenceKnob = page.getByRole('slider', { name: 'Parameter control' });
        await expect(referenceKnob).toHaveAttribute('aria-valuenow', '440');

        const minBound = await referenceKnob.getAttribute('aria-valuemin');
        const maxBound = await referenceKnob.getAttribute('aria-valuemax');
        expect(minBound).not.toBeNull();
        expect(maxBound).not.toBeNull();

        await referenceKnob.focus();

        // End commits the upper bound: aria-valuenow must equal aria-valuemax.
        await page.keyboard.press('End');
        await expect(referenceKnob).toHaveAttribute('aria-valuenow', maxBound as string);

        // Home commits the lower bound: aria-valuenow must equal aria-valuemin.
        await page.keyboard.press('Home');
        await expect(referenceKnob).toHaveAttribute('aria-valuenow', minBound as string);
    });
});
