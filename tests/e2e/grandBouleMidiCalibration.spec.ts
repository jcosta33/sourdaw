import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openGrandBoulePanel(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();

    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible();
}

// The calibration section nests two matching <section> elements (panel body
// + section card), so textual section scoping is ambiguous; the knob labels
// themselves are unique app-wide, and the readout lives in the knob's own
// column (its parent element).
function calibrationKnob(page: Page, label: string) {
    return page.getByRole('slider', { name: label });
}

// The calibration knobs got aria-labels in #1918 but no E2E has ever driven
// them: a knob resolving to 'Parameter control' means the label regressed.
test.describe('Grand Boule MIDI calibration knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openGrandBoulePanel(page);
        await expect(page.getByText('MIDI Calibration').first()).toBeVisible();
    });

    test('CC Smooth steps via keyboard and its readout follows', async ({ page }) => {
        const ccSmooth = calibrationKnob(page, 'CC Smooth');
        const before = Number(await ccSmooth.getAttribute('aria-valuenow'));

        await ccSmooth.focus();
        await page.keyboard.press('ArrowUp');
        // Retrying assertion: the value moves off the pre-step reading once
        // the store-driven re-render lands.
        await expect(ccSmooth).not.toHaveAttribute('aria-valuenow', String(before));
        const after = Number(await ccSmooth.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
        // The readout is a rounded milliseconds value derived from the same
        // calibration state the knob writes.
        await expect(ccSmooth.locator('xpath=..')).toContainText(`${Math.round(after)} ms`);
    });

    test('Velocity Curve and Floor/Ceiling are addressable by their labels', async ({ page }) => {
        for (const label of ['Velocity Curve', 'Floor', 'Ceiling', 'Sus Thresh']) {
            await expect(calibrationKnob(page, label)).toBeAttached();
        }
    });

    test('Reset calibration restores the default CC smoothing', async ({ page }) => {
        const ccSmooth = calibrationKnob(page, 'CC Smooth');
        const defaultValue = Number(await ccSmooth.getAttribute('aria-valuenow'));

        await ccSmooth.focus();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await expect(Number(await ccSmooth.getAttribute('aria-valuenow'))).toBeGreaterThan(defaultValue);

        // The reset chip lives in the calibration section card — the inner of
        // the two nested matching sections — alongside the knob columns.
        const calibrationCard = page.locator('section').filter({ hasText: 'MIDI Calibration' }).last();
        await calibrationCard.getByRole('button', { name: /Reset/i }).click();
        await expect(ccSmooth).toHaveAttribute('aria-valuenow', String(defaultValue));
    });
});
