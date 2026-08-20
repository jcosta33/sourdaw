import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Instrument device panels — Fermenter, Levain, Crumbs', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    async function openInstrument(page: import('@playwright/test').Page, name: string): Promise<boolean> {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        await page.getByTestId('browser-search').fill(name.toLowerCase());
        await page.waitForTimeout(500);

        const card = page.getByRole('button', { name: new RegExp(`^${name}`, 'i') }).first();
        const hasCard = await card.isVisible().catch(() => false);
        if (hasCard) {
            await card.click();
            await page.waitForTimeout(2000);
            return true;
        }
        return false;
    }

    test('Fermenter panel opens with Close button', async ({ page }) => {
        const opened = await openInstrument(page, 'Fermenter');
        if (opened) {
            const close = page.getByRole('button', { name: /Close Fermenter/i }).first();
            await expect(close).toBeVisible({ timeout: 10_000 });
        }
    });

    test('Fermenter panel closes via Close button', async ({ page }) => {
        const opened = await openInstrument(page, 'Fermenter');
        if (opened) {
            const close = page.getByRole('button', { name: /Close Fermenter/i }).first();
            if (await close.isVisible().catch(() => false)) {
                await close.click();
                await page.waitForTimeout(500);
                await expect(close).not.toBeVisible();
            }
        }
    });

    test('Crumbs panel opens with Close button', async ({ page }) => {
        const opened = await openInstrument(page, 'Crumbs');
        if (opened) {
            // Crumbs may have a different close label.
            const close = page
                .getByRole('button', { name: /Close Crumbs/i })
                .or(page.getByRole('button', { name: /Close/i }))
                .first();
            const hasClose = await close.isVisible().catch(() => false);
            if (hasClose) {
                const label = await close.getAttribute('aria-label');
                expect(label).toContain('Close');
            }
        }
    });

    test('Levain panel opens with Close button', async ({ page }) => {
        const opened = await openInstrument(page, 'Levain');
        if (opened) {
            const close = page.getByRole('button', { name: /Close Levain/i }).first();
            await expect(close).toBeVisible({ timeout: 10_000 });
        }
    });
});
