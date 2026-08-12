import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenterEffectsMod(page: import('@playwright/test').Page): Promise<void> {
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
    const effectsTab = page.locator('.fermenter-faceplate').getByRole('button', { name: 'Effects', exact: true }).first();
    await effectsTab.dispatchEvent('click');
    await page.waitForTimeout(400);
    // Switch to the Mod (Chorus/Phaser) sub-tab.
    const modTab = page.locator('.fermenter-faceplate').getByRole('button', { name: 'Chorus/Phaser', exact: true }).first();
    await modTab.dispatchEvent('click');
    await page.waitForTimeout(300);
}

// Fermenter FX Mod tab knobs (Chorus: Rate, Depth, Mix; Phaser: Rate, Depth, Mix).
// #1842 Dist, #1843 Reverb, #1844 Comp, #1845 Delay. This covers Mod tab.
test.describe('Fermenter FX Mod knobs — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterEffectsMod(page);
    });

    test('Chorus Rate knob responds to keyboard', async ({ page }) => {
        // The Mod tab has Chorus and Phaser sections, each with Rate/Depth/Mix.
        // There may be name collisions ("Rate" appears twice). Use .first().
        const rate = page.getByRole('slider', { name: 'Rate', exact: true }).first();
        await expect(rate).toBeAttached({ timeout: 10_000 });
        await rate.focus();
        const before = Number(await rate.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await rate.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Chorus Mix knob responds to keyboard', async ({ page }) => {
        const mix = page.getByRole('slider', { name: 'Mix', exact: true }).first();
        await expect(mix).toBeAttached({ timeout: 10_000 });
        await mix.focus();
        const before = Number(await mix.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await mix.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
