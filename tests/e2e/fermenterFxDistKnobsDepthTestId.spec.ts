import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenterEffects(page: import('@playwright/test').Page): Promise<void> {
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
    // Switch to Effects section.
    const effectsTab = page.locator('.fermenter-faceplate').getByRole('button', { name: 'Effects', exact: true }).first();
    await effectsTab.dispatchEvent('click');
    await page.waitForTimeout(400);
}

// Fermenter Effects Dist tab knobs (Drive, Tone, Mix). The #1781 spec covered
// the FX sub-tab SWITCH but not the knobs within each tab. The knobs sit behind
// a clipping ancestor so visibility fails — but they ARE in the DOM and
// keyboard works. This uses toBeAttached + focus + ArrowUp.
test.describe('Fermenter FX Dist tab knobs — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterEffects(page);
    });

    test('Dist Drive knob responds to keyboard', async ({ page }) => {
        const drive = page.getByRole('slider', { name: 'Drive', exact: true }).first();
        await expect(drive).toBeAttached({ timeout: 10_000 });
        await drive.focus();
        const before = Number(await drive.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await drive.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Dist Mix knob responds to keyboard', async ({ page }) => {
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
