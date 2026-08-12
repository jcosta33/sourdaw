import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenterEffectsComp(page: import('@playwright/test').Page): Promise<void> {
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
    // Switch to the Effects section. The section button sits behind a clipping
    // ancestor so a pointer click is reported as intercepted — dispatch a click
    // on the node (#1781/#1842 pattern).
    const panel = page.locator('.fermenter-faceplate');
    const effectsTab = panel.getByRole('button', { name: 'Effects', exact: true }).first();
    await effectsTab.dispatchEvent('click');
    await page.waitForTimeout(400);
    // Switch to the Comp FX sub-tab. Dist is the default FX tab, so the Comp
    // knobs are not mounted until the swap. Same clip constraint, so dispatch a
    // click on the chip (#1781 pattern).
    const compChip = panel.getByRole('button', { name: 'Comp', exact: true }).first();
    await compChip.dispatchEvent('click');
    await page.waitForTimeout(400);
}

// Fermenter Effects Comp tab knobs (Thresh, Ratio, Attack, Release). The #1781
// spec covered the FX sub-tab SWITCH, #1842 covered the Dist tab knobs; the
// Comp tab knobs were uncovered. The knobs sit behind a clipping ancestor so
// visibility fails — but they ARE in the DOM and keyboard works. This uses
// toBeAttached + focus + ArrowUp.
test.describe('Fermenter FX Comp tab knobs — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenterEffectsComp(page);
    });

    test('Comp Thresh knob responds to keyboard', async ({ page }) => {
        const thresh = page.getByRole('slider', { name: 'Thresh', exact: true }).first();
        await expect(thresh).toBeAttached({ timeout: 10_000 });
        await thresh.focus();
        const before = Number(await thresh.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await thresh.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Comp Ratio knob responds to keyboard', async ({ page }) => {
        const ratio = page.getByRole('slider', { name: 'Ratio', exact: true }).first();
        await expect(ratio).toBeAttached({ timeout: 10_000 });
        await ratio.focus();
        const before = Number(await ratio.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await ratio.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
