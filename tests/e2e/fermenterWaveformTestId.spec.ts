import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenter(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('fermenter');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Fermenter/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the Close control appears once FermenterPanel has
    // rendered. Bounded to 30s so a slow-but-healthy mount is not mistaken for
    // the known Fermenter panel-open hang.
    await expect(page.getByRole('button', { name: /Close Fermenter/i }).first()).toBeVisible({
        timeout: 30_000,
    });
}

test.describe('Fermenter oscillator waveform selection', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('selecting a waveform chip flips the active state', async ({ page }) => {
        await openFermenter(page);

        // The Oscillator waveform selector carries the full shape names ("Sine",
        // "Saw", "Square", "Triangle"). The LFO section truncates its shape chips
        // to three letters ("Sin", "Tri", "Squ"), so "Triangle" is unique to the
        // oscillator; its parent row holds all four waveform chips.
        const waveformRow = page
            .getByRole('button', { name: 'Triangle', exact: true })
            .locator('xpath=..');
        const chips = waveformRow.getByRole('button');
        await expect(chips).toHaveCount(4);

        // Exactly one waveform chip is pressed at a time. The patch default is
        // Saw (oscWaveform: 1), so the Saw chip carries aria-pressed.
        const saw = waveformRow.getByRole('button', { name: 'Saw', exact: true });
        const sine = waveformRow.getByRole('button', { name: 'Sine', exact: true });
        await expect(waveformRow.locator('button[aria-pressed="true"]')).toHaveCount(1);
        await expect(saw).toHaveAttribute('aria-pressed', 'true');
        await expect(sine).not.toHaveAttribute('aria-pressed', 'true');

        // The waveform chips sit behind a clipping ancestor in the Fermenter
        // panel's bottom dock, so a coordinate-based pointer click is reported
        // as intercepted; Space is bound to transport play/stop. Dispatching a
        // click event on the chip node itself fires the same React onClick the
        // chip routes to onWaveformChange.
        await sine.dispatchEvent('click');

        // The flip: Sine is now the selected waveform, Saw is released.
        await expect(sine).toHaveAttribute('aria-pressed', 'true');
        await expect(saw).not.toHaveAttribute('aria-pressed', 'true');
    });
});
