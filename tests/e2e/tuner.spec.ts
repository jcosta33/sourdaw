import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Opens the Scoring (Tuner) device panel on a fresh Audio track and returns
 * once the panel's close control is visible. Mirrors the device-expansion
 * flow proven in devicePanels.spec.ts (Add device -> menuitem -> open panel).
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

    // The device card lands in the chain before the panel opens.
    const scoringCard = page.getByText('Scoring', { exact: true });
    await scoringCard.dblclick();

    await expect(page.getByRole('button', { name: 'Close Scoring' })).toBeVisible();
}

test.describe('Tuner (Scoring device panel)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Adding a Scoring device opens the tuner panel with default reference and needle mode', async ({
        page,
    }) => {
        await open_scoring_panel(page);

        // Default display mode is 'needle' — its mode button is pressed, the
        // others are not, and the needle canvas (not strobe/poly) is rendered.
        const needleButton = page.getByRole('button', { name: 'Needle display mode' });
        const strobeButton = page.getByRole('button', { name: 'Strobe display mode' });
        const polyButton = page.getByRole('button', { name: 'Poly display mode' });
        await expect(needleButton).toHaveAttribute('aria-pressed', 'true');
        await expect(strobeButton).toHaveAttribute('aria-pressed', 'false');
        await expect(polyButton).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByRole('img', { name: 'Needle tuner display' })).toBeVisible();

        // Default A4 reference is 440 Hz, reflected on the reference knob.
        const referenceKnob = page.getByRole('slider', { name: 'Parameter control' });
        await expect(referenceKnob).toHaveAttribute('aria-valuenow', '440');
    });

    test('Switching display mode updates the pressed button and the rendered display', async ({ page }) => {
        await open_scoring_panel(page);

        const needleButton = page.getByRole('button', { name: 'Needle display mode' });
        const strobeButton = page.getByRole('button', { name: 'Strobe display mode' });

        await strobeButton.click();

        await expect(strobeButton).toHaveAttribute('aria-pressed', 'true');
        await expect(needleButton).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByRole('img', { name: 'Strobe tuner display' })).toBeVisible();
        await expect(page.getByRole('img', { name: 'Needle tuner display' })).not.toBeVisible();

        const polyButton = page.getByRole('button', { name: 'Poly display mode' });
        await polyButton.click();

        await expect(polyButton).toHaveAttribute('aria-pressed', 'true');
        await expect(strobeButton).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByRole('img', { name: 'Strobe tuner display' })).not.toBeVisible();
    });

    test('Can adjust the A4 reference pitch via keyboard and the displayed value updates', async ({ page }) => {
        await open_scoring_panel(page);

        const referenceKnob = page.getByRole('slider', { name: 'Parameter control' });
        await expect(referenceKnob).toHaveAttribute('aria-valuenow', '440');

        await referenceKnob.focus();
        await page.keyboard.press('ArrowUp');

        // The knob is a controlled component driven by the tuner store; the
        // committed value must move off the default and stay a whole Hz value.
        await expect(referenceKnob).not.toHaveAttribute('aria-valuenow', '440');
        const raised = Number(await referenceKnob.getAttribute('aria-valuenow'));
        expect(raised).toBeGreaterThan(440);

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        const lowered = Number(await referenceKnob.getAttribute('aria-valuenow'));
        expect(lowered).toBeLessThan(raised);
    });
});
