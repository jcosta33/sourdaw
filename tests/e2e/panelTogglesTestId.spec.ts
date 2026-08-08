import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Panel toggles round-trip — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('track list toggle round-trips aria-pressed', async ({ page }) => {
        const toggle = page.getByTestId('toggle-track-list');
        await expect(toggle).toBeVisible({ timeout: 10_000 });

        const before = await toggle.getAttribute('aria-pressed');
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '');

        // Toggle back.
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', before ?? '');
    });

    test('inspector toggle round-trips aria-pressed', async ({ page }) => {
        const toggle = page.getByTestId('toggle-inspector');
        await expect(toggle).toBeVisible({ timeout: 10_000 });

        const before = await toggle.getAttribute('aria-pressed');
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', before ?? '');
    });

    test('bottom dock toggle round-trips aria-pressed', async ({ page }) => {
        const toggle = page.getByTestId('toggle-bottom-dock');
        await expect(toggle).toBeVisible({ timeout: 10_000 });

        const before = await toggle.getAttribute('aria-pressed');
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', before ?? '');
    });

    test('dual view toggle round-trips aria-pressed', async ({ page }) => {
        const toggle = page.getByTestId('toggle-dual-view');
        await expect(toggle).toBeVisible({ timeout: 10_000 });

        const before = await toggle.getAttribute('aria-pressed');
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', before ?? '');
    });

    test('multiple panels can be open simultaneously', async ({ page }) => {
        const trackList = page.getByTestId('toggle-track-list');
        const inspector = page.getByTestId('toggle-inspector');
        const dock = page.getByTestId('toggle-bottom-dock');

        // Open all three.
        const tlBefore = await trackList.getAttribute('aria-pressed');
        if (tlBefore === 'false') {
            await trackList.click();
        }
        const insBefore = await inspector.getAttribute('aria-pressed');
        if (insBefore === 'false') {
            await inspector.click();
        }
        const dockBefore = await dock.getAttribute('aria-pressed');
        if (dockBefore === 'false') {
            await dock.click();
        }
        await page.waitForTimeout(500);

        // All should be pressed=true.
        await expect(trackList).toHaveAttribute('aria-pressed', 'true');
        await expect(inspector).toHaveAttribute('aria-pressed', 'true');
        await expect(dock).toHaveAttribute('aria-pressed', 'true');
    });
});
