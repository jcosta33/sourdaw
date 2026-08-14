import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// Toaster Euclid fill tools. The hits/steps number inputs + Toast chip apply
// a Euclidean rhythm to the selected pad's track. The inputs are plain number
// inputs (no aria-labels — reachable via the "of" separator scope). No E2E
// covers them.
test.describe('Toaster Euclid fill — inputs accept values', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('Euclid hits input accepts a typed value', async ({ page }) => {
        // The Euclid section has two native number inputs separated by "of".
        // Scope to the Toaster faceplate (not the whole page — the transport
        // BPM is also a spinbutton role).
        const toaster = page.locator('.toaster-window, [class*="toaster"]').locator('..');
        // Target the number inputs directly by type within the Euclid context.
        const euclidInputs = page
            .locator('div')
            .filter({ has: page.getByText('of', { exact: true }) })
            .locator('input[type="number"]');
        await expect(euclidInputs.first()).toBeVisible({ timeout: 10_000 });
        expect(await euclidInputs.count()).toBeGreaterThanOrEqual(2);

        // Fill the hits input with a new value.
        const hits = euclidInputs.first();
        await hits.fill('3');
        await expect(hits).toHaveValue('3');

        // Fill the steps input too.
        const steps = euclidInputs.nth(1);
        await steps.fill('8');
        await expect(steps).toHaveValue('8');
    });
});
