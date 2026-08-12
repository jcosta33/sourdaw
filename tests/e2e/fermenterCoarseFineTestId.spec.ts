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

// Fermenter oscillator Coarse + Fine pitch knobs (always visible on the default
// Oscillator section). No E2E covers these — the existing Fermenter specs cover
// Unison knobs + Macro combobox + filter knobs + envelope + LFO + FX + waveform.
test.describe('Fermenter Coarse + Fine knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('Coarse pitch knob responds to keyboard', async ({ page }) => {
        const coarse = page.getByRole('slider', { name: 'Coarse', exact: true }).first();
        await expect(coarse).toBeVisible({ timeout: 10_000 });
        await coarse.focus();
        const before = Number(await coarse.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await coarse.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Fine pitch knob responds to keyboard', async ({ page }) => {
        const fine = page.getByRole('slider', { name: 'Fine', exact: true }).first();
        await expect(fine).toBeVisible({ timeout: 10_000 });
        await fine.focus();
        const before = Number(await fine.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await fine.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
