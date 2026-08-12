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

// Fermenter LFO → Pitch + → Filter routing knobs (bipolar, default 0). The LFO
// block is co-rendered in the Envelopes section. #1774 covered the Rate knob;
// these routing knobs were noted as "bipolar at 0" — ArrowUp should still move
// them off center.
test.describe('Fermenter LFO → Pitch + → Filter routing knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterEnvelopes(page);
    });

    test('→ Pitch knob responds to keyboard', async ({ page }) => {
        const pitch = page.getByRole('slider', { name: '→ Pitch', exact: true }).first();
        await expect(pitch).toBeVisible({ timeout: 10_000 });
        await pitch.focus();
        const before = Number(await pitch.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await pitch.getAttribute('aria-valuenow'));
        expect(after).not.toBe(before);
    });

    test('→ Filter knob responds to keyboard', async ({ page }) => {
        const filter = page.getByRole('slider', { name: '→ Filter', exact: true }).first();
        await expect(filter).toBeVisible({ timeout: 10_000 });
        await filter.focus();
        const before = Number(await filter.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await filter.getAttribute('aria-valuenow'));
        expect(after).not.toBe(before);
    });
});
