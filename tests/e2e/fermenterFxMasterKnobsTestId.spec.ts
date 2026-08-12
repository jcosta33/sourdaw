import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenterEffectsMaster(page: import('@playwright/test').Page): Promise<void> {
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
    // Switch to the Master sub-tab.
    const masterTab = page.locator('.fermenter-faceplate').getByRole('button', { name: 'Master', exact: true }).first();
    await masterTab.dispatchEvent('click');
    await page.waitForTimeout(300);
}

// Fermenter FX Master tab: stereoWidth + masterGain knobs (paramId-named).
// The last FX tab. Completes the 7-tab FX matrix.
test.describe('Fermenter FX Master knobs — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterEffectsMaster(page);
    });

    test('Stereo Width knob responds to keyboard', async ({ page }) => {
        const width = page.getByRole('slider', { name: 'stereoWidth' }).first();
        await expect(width).toBeAttached({ timeout: 10_000 });
        await width.focus();
        const before = Number(await width.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await width.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Master Gain knob responds to keyboard', async ({ page }) => {
        const gain = page.getByRole('slider', { name: 'masterGain' }).first();
        await expect(gain).toBeAttached({ timeout: 10_000 });
        await gain.focus();
        const before = Number(await gain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
