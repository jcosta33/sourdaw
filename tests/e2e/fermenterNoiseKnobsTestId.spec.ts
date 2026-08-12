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
    await expect(page.getByRole('button', { name: /Close Fermenter/i }).first()).toBeVisible({ timeout: 15_000 });
}

// Fermenter noise level + color knobs (in the Oscillator section, paramId-named).
// No E2E covers these — the oscillator waveform + Unison knobs are covered.
test.describe('Fermenter noise level + color knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('noise level knob responds to keyboard', async ({ page }) => {
        // The knob passes label="Noise" to RotaryKnob → aria-label resolves to
        // "Noise" (not paramId "noiseLevel").
        const noise = page.getByRole('slider', { name: 'Noise', exact: true }).first();
        await expect(noise).toBeVisible({ timeout: 10_000 });
        await noise.focus();
        const before = Number(await noise.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await noise.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
