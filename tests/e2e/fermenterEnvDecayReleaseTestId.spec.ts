import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenterEnvelopes(page: import('@playwright/test').Page): Promise<void> {
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
    await page.getByRole('button', { name: 'Envelopes', exact: true }).first().click();
    await page.waitForTimeout(400);
}

// Fermenter envelope Decay + Release knobs (paramId-named, Envelopes section).
// #1775 covered Attack + Sustain; these complete the ADSR quartet.
test.describe('Fermenter envelope Decay + Release knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterEnvelopes(page);
    });

    test('Decay knob responds to keyboard', async ({ page }) => {
        const decay = page.getByRole('slider', { name: 'ampDecay' }).first();
        await expect(decay).toBeVisible({ timeout: 10_000 });
        await decay.focus();
        const before = Number(await decay.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await decay.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Release knob responds to keyboard', async ({ page }) => {
        const release = page.getByRole('slider', { name: 'ampRelease' }).first();
        await expect(release).toBeVisible({ timeout: 10_000 });
        await release.focus();
        const before = Number(await release.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await release.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
