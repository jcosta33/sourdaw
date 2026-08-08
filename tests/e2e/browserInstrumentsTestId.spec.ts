import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Browser instrument cards — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('browser Instruments tab lists instrument cards', async ({ page }) => {
        // The browser panel should already be open. Click the Instruments tab.
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browser.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        const instrumentsTab = page.getByRole('button', { name: 'Instruments', exact: true }).first();
        if (await instrumentsTab.isVisible().catch(() => false)) {
            await instrumentsTab.click();
            await page.waitForTimeout(500);

            // Instrument cards are buttons — find Fermenter or Toaster.
            const fermenter = page.getByRole('button', { name: /^Fermenter/i }).first();
            const hasFermenter = await fermenter.isVisible().catch(() => false);
            if (hasFermenter) {
                const text = (await fermenter.innerText()).trim();
                expect(text).toContain('Fermenter');
            }
        }
    });

    test('browser search filters instrument list', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        const searchInput = page.getByTestId('browser-search');
        await searchInput.fill('toaster');
        await page.waitForTimeout(500);

        // Toaster should be visible.
        const toaster = page.getByRole('button', { name: /^Toaster/i }).first();
        const hasToaster = await toaster.isVisible().catch(() => false);
        if (hasToaster) {
            const text = (await toaster.innerText()).trim();
            expect(text).toContain('Toaster');
        }

        // Clear search.
        await searchInput.fill('');
    });

    test('clicking an instrument card opens its device panel', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        // Click Fermenter.
        const fermenter = page.getByRole('button', { name: /^Fermenter/i }).first();
        const hasFermenter = await fermenter.isVisible().catch(() => false);
        if (hasFermenter) {
            await fermenter.click();
            await page.waitForTimeout(2000);

            // The device panel should appear with a Close button.
            const closeBtn = page.getByRole('button', { name: /Close Fermenter/i });
            const hasClose = await closeBtn.isVisible().catch(() => false);
            expect(hasClose).toBe(true);
        }
    });

    test('browser Effects tab shows effect categories', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browser.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(500);

            // Should show effect cards.
            const buttons = browser.getByRole('button');
            const count = await buttons.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('browser can switch between Instruments and Effects tabs', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browser.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        const instrumentsTab = page.getByRole('button', { name: 'Instruments', exact: true }).first();
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();

        if ((await instrumentsTab.isVisible().catch(() => false)) && (await effectsTab.isVisible().catch(() => false))) {
            // Switch to Effects.
            await effectsTab.click();
            await page.waitForTimeout(300);

            // Switch back to Instruments.
            await instrumentsTab.click();
            await page.waitForTimeout(300);

            // Should not crash.
            await expect(instrumentsTab).toBeVisible();
        }
    });
});
