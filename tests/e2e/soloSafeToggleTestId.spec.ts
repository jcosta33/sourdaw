import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Solo-safe excludes a track from solo muting. It is reachable via the mixer
// strip's context menu (right-click → "Solo Safe") and observable two ways: the
// menuitem relabels Solo Safe ↔ Disable Solo Safe, and the ShieldCheck indicator
// (aria-label "Solo safe") appears on the strip. No E2E covered this control.
test.describe('Solo-safe toggle — context menu + indicator', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });
    });

    test('enabling Solo Safe reveals the ShieldCheck indicator and relabels the menuitem', async ({ page }) => {
        const strip = page.getByRole('group', { name: 'Audio channel' });

        // Before: no Solo-safe indicator on the strip.
        await expect(strip.getByLabel('Solo safe')).toHaveCount(0);

        // Right-click the strip to open its context menu.
        await strip.click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        await page.getByRole('menuitem', { name: 'Solo Safe' }).click();
        await page.waitForTimeout(300);

        // The ShieldCheck indicator appears on the strip — solo-safe is active.
        await expect(strip.getByLabel('Solo safe')).toBeVisible({ timeout: 5000 });

        // Reopening the menu, the item now reads "Disable Solo Safe" (relabel).
        await strip.click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        await page.getByRole('menuitem', { name: 'Disable Solo Safe' }).click();
        await page.waitForTimeout(300);

        // Disabling removes the indicator — the toggle round-trips.
        await expect(strip.getByLabel('Solo safe')).toHaveCount(0);
    });
});
