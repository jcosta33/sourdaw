import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Opens the Grand Boule piano panel from the Browser panel's Instruments
 * tab. Unlike the effect/utility devices added through the inspector's
 * "Add device" menu (see devicePanels.spec.ts / tuner.spec.ts), Grand Boule
 * is a "House Special" instrument card: clicking it creates its own MIDI
 * track, attaches the device, and opens the panel in one step.
 */
async function open_grand_boule_panel(page: import('@playwright/test').Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();

    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible();
}

/**
 * Scopes to the "Touch" velocity-curve section specifically. A plain
 * substring filter on "Touch" also matches the MIDI Calibration section
 * (its "Aftertouch" knob contains the same substring), so this uses a
 * case-sensitive regex — the section heading is "Touch", the calibration
 * label is lowercase "touch" inside "Aftertouch".
 */
function touch_section(page: import('@playwright/test').Page) {
    return page.locator('section').filter({ hasText: /Touch/ });
}

test.describe('Grand Boule (physical-modeling piano panel)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Opening Grand Boule from the browser renders the faceplate with the default temperament', async ({
        page,
    }) => {
        await open_grand_boule_panel(page);

        await expect(page.getByText('Physical Modeling Piano')).toBeVisible();

        // Default temperament is Equal (index 0) — its option carries the
        // active styling, the others do not.
        const equalOption = page.getByRole('button', { name: 'Equal', exact: true });
        const werckmeisterOption = page.getByRole('button', { name: 'Werckmeister III' });
        await expect(equalOption).toBeVisible();
        await expect(equalOption).toHaveClass(/text-neutral-200/);
        await expect(werckmeisterOption).not.toHaveClass(/text-neutral-200/);

        // Default velocity curve is 1.0 (linear), reflected on the Touch knob.
        const touchSection = touch_section(page);
        await expect(touchSection.getByRole('slider', { name: 'Curve', exact: true })).toHaveAttribute(
            'aria-valuenow',
            '1'
        );
        await expect(touchSection.getByText('linear')).toBeVisible();
    });

    test('Selecting a different temperament updates which option is active', async ({ page }) => {
        await open_grand_boule_panel(page);

        const equalOption = page.getByRole('button', { name: 'Equal', exact: true });
        const werckmeisterOption = page.getByRole('button', { name: 'Werckmeister III' });

        await werckmeisterOption.click();

        await expect(werckmeisterOption).toHaveClass(/text-neutral-200/);
        await expect(equalOption).not.toHaveClass(/text-neutral-200/);
    });

    test('Adjusting the Touch velocity-curve knob via keyboard moves the value and readout both ways', async ({
        page,
    }) => {
        await open_grand_boule_panel(page);

        const touchSection = touch_section(page);
        const curveKnob = touchSection.getByRole('slider', { name: 'Curve', exact: true });
        await expect(curveKnob).toHaveAttribute('aria-valuenow', '1');

        // Two ArrowUp presses (step 0.05) cross the >1.05 "hard" threshold.
        await curveKnob.focus();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');

        const raised = Number(await curveKnob.getAttribute('aria-valuenow'));
        expect(raised).toBeGreaterThan(1.05);
        await expect(touchSection.getByText('hard')).toBeVisible();

        // Four ArrowDown presses cross back under the <0.95 "soft" threshold.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');

        const lowered = Number(await curveKnob.getAttribute('aria-valuenow'));
        expect(lowered).toBeLessThan(raised);
        expect(lowered).toBeLessThan(0.95);
        await expect(touchSection.getByText('soft')).toBeVisible();
    });
});
