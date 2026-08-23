import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

// Two Inspector/Transport controls that the final audit found uncovered:
//
// 1. SpatialPanner — the canvas XY panner (role="slider") in the Inspector's
//    master-only "Analysis & Metering" section. Keyboard arrows must move the
//    exposed azimuth value.
// 2. ArrangementSelector — the TransportBar dropdown that manages arrangement
//    snapshots. It only mounts once the project holds more than one
//    arrangement, so this spec seeds a second snapshot through the real
//    createArrangement use case (the same call the menu's "New Arrangement"
//    item makes) before opening it.

test.describe('SpatialPanner and ArrangementSelector', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'EDM' });
    });

    test('SpatialPanner slider raises aria-valuenow on ArrowUp from the master Inspector', async ({ page }) => {
        // The Analysis & Metering section is master-only; the TrackList footer
        // spectrum widget is the reliable way to select the master track on a
        // template launch (a user track may already be selected).
        await page.getByRole('button', { name: 'Master Track Spectrum' }).click();

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByText('Analysis & Metering')).toBeVisible();
        await inspector.getByRole('combobox', { name: 'Analyzer' }).selectOption('panner');

        const panner = page.getByRole('slider', { name: /Spatial panner:/ });
        await expect(panner).toBeVisible();
        await expect(panner).toHaveAttribute('aria-valuenow', '0');

        // Keyboard contract: focus the slider and step the azimuth up.
        await panner.focus();
        await page.keyboard.press('ArrowUp');
        await expect(panner).toHaveAttribute('aria-valuenow', '15');

        // And back down below the launch value, proving the step is bidirectional.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(panner).toHaveAttribute('aria-valuenow', '-15');
    });

    test('ArrangementSelector opens its menu and switches the active arrangement', async ({ page }) => {
        const selector = page.getByRole('button', { name: 'Arrangement selector' });

        // The selector stays unmounted at exactly one arrangement — seed a
        // second snapshot through the product use case first.
        await expect(selector).toHaveCount(0);
        await page.evaluate(async () => {
            const { createArrangement } =
                await import('/src/modules/Project/useCases/arrangement/createArrangement.ts');
            createArrangement('Arrangement 2');
        });
        await expect(selector).toBeVisible();
        await expect(selector).toHaveAttribute('aria-expanded', 'false');
        // createArrangement makes the fresh snapshot active, so the button
        // readout names it before the menu is opened.
        await expect(selector).toHaveText(/Arrangement 2/);

        await selector.click();
        const menu = page.getByRole('menu', { name: 'Arrangement menu' });
        await expect(menu).toBeVisible();
        await expect(selector).toHaveAttribute('aria-expanded', 'true');
        await expect(menu.getByText('Arrangement 1')).toBeVisible();
        await expect(menu.getByText('Arrangement 2')).toBeVisible();

        // Switching snapshots is the state change: the readout follows the
        // newly active arrangement. The menu intentionally stays open (only
        // Escape or an outside click closes it), so close it explicitly and
        // assert the collapsed state.
        await menu.getByText('Arrangement 1').click();
        await expect(selector).toHaveText(/Arrangement 1/);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(selector).toHaveAttribute('aria-expanded', 'false');
    });
});
