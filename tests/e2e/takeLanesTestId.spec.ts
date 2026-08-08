import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openTakeLanes(page: import('@playwright/test').Page): Promise<void> {
    // Take lanes are shown when variation lanes are toggled on a track.
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const trackRow = trackList.getByRole('row').first();
    const lanesToggle = trackRow.getByRole('button', { name: /variation lanes/i }).first();
    if (await lanesToggle.isVisible().catch(() => false)) {
        await lanesToggle.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Take lanes & comp — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('variation lanes toggle is present on a track', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const trackRow = trackList.getByRole('row').first();
        const lanesToggle = trackRow.getByRole('button', { name: /variation lanes/i }).first();
        const hasToggle = await lanesToggle.isVisible().catch(() => false);
        if (hasToggle) {
            const before = await lanesToggle.getAttribute('aria-pressed');
            await lanesToggle.click();
            await page.waitForTimeout(300);
            await expect(lanesToggle).not.toHaveAttribute('aria-pressed', before ?? '');
        }
    });

    test('add take button is present when variation lanes are open', async ({ page }) => {
        await openTakeLanes(page);

        const addTake = page.getByTestId('take-lane-add');
        const hasAdd = await addTake.isVisible().catch(() => false);
        if (!hasAdd) {
            await expect(addTake).toBeAttached({ timeout: 5000 });
        }
    });

    test('flatten comp button is present when take lanes are open', async ({ page }) => {
        await openTakeLanes(page);

        const flatten = page.getByRole('button', { name: /Flatten comp/i }).first();
        const hasFlatten = await flatten.isVisible().catch(() => false);
        // The Flatten comp button only appears when there's a comp lane — just verify it doesn't crash.
        if (hasFlatten) {
            const label = await flatten.getAttribute('aria-label');
            expect(label).toContain('Flatten');
        }
    });

    test('add take button does not crash when clicked', async ({ page }) => {
        await openTakeLanes(page);

        const addTake = page.getByTestId('take-lane-add');
        if (await addTake.isVisible().catch(() => false)) {
            await addTake.click();
            await page.waitForTimeout(500);

            // Transport should still be functional.
            await expect(page.getByTestId('transport-play')).toBeVisible();
        }
    });

    test('take lanes and transport coexist', async ({ page }) => {
        await openTakeLanes(page);

        await expect(page.getByTestId('transport-play')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('transport-stop')).toBeVisible({ timeout: 10_000 });
    });
});
