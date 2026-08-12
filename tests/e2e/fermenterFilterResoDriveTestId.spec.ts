import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenterFilter(page: import('@playwright/test').Page): Promise<void> {
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
    // Switch to the Filter section (panel defaults to Oscillator).
    await page.getByRole('button', { name: 'Filter', exact: true }).first().click();
    await page.waitForTimeout(400);
}

// Fermenter filter Resonance + Drive + Key knobs (paramId-named, same Filter
// section as #1771 which covered Cutoff + Env).
test.describe('Fermenter filter Reso + Drive + Key knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterFilter(page);
    });

    test('Resonance knob responds to keyboard', async ({ page }) => {
        const reso = page.getByRole('slider', { name: 'filterResonance' }).first();
        await expect(reso).toBeVisible({ timeout: 10_000 });
        await reso.focus();
        const before = Number(await reso.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await reso.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Drive knob responds to keyboard', async ({ page }) => {
        const drive = page.getByRole('slider', { name: 'Drive', exact: true }).first();
        await expect(drive).toBeVisible({ timeout: 10_000 });
        await drive.focus();
        const before = Number(await drive.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await drive.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Key knob responds to keyboard', async ({ page }) => {
        const key = page.getByRole('slider', { name: 'Key', exact: true }).first();
        await expect(key).toBeVisible({ timeout: 10_000 });
        await key.focus();
        const before = Number(await key.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await key.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
