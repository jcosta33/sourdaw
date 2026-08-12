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

// Fermenter Macro strip remaining 5 knobs. #1779 covered Brightness, Width,
// Character. These cover Motion, Dirt, Space, Punch, Texture.
test.describe('Fermenter Macro remaining knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    for (const label of ['Motion', 'Dirt', 'Space', 'Punch', 'Texture']) {
        test(`${label} knob responds to keyboard`, async ({ page }) => {
            const knob = page.getByRole('slider', { name: label, exact: true }).first();
            await expect(knob).toBeVisible({ timeout: 10_000 });
            await knob.focus();
            const before = Number(await knob.getAttribute('aria-valuenow'));
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(200);
            const after = Number(await knob.getAttribute('aria-valuenow'));
            expect(after).toBeGreaterThan(before);
        });
    }
});
