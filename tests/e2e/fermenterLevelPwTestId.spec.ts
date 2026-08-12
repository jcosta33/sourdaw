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

// Fermenter oscillator Level knob. The remaining oscillator control not yet
// covered (waveform, Coarse, Fine, Noise, Unison all done). PW is conditional
// on waveform mode and deferred.
test.describe('Fermenter Level knob', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('Level knob responds to keyboard', async ({ page }) => {
        const level = page.getByRole('slider', { name: 'Level', exact: true }).first();
        await expect(level).toBeVisible({ timeout: 10_000 });
        await level.focus();
        const before = Number(await level.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await level.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
