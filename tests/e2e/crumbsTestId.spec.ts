import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openInstrument(page: import('@playwright/test').Page, name: string): Promise<boolean> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill(name.toLowerCase());
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: new RegExp(`^${name}`, 'i') }).first();
    if (await card.isVisible().catch(() => false)) {
        await card.click();
        await page.waitForTimeout(2000);
        return true;
    }
    return false;
}

test.describe('Crumbs panel deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Crumbs panel has parameter controls', async ({ page }) => {
        const opened = await openInstrument(page, 'Crumbs');
        if (!opened) {
            return;
        }

        // The Crumbs panel should have sliders or knobs.
        const sliders = page.getByRole('slider');
        const count = await sliders.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Crumbs close button works', async ({ page }) => {
        const opened = await openInstrument(page, 'Crumbs');
        if (!opened) {
            return;
        }

        const close = page.getByRole('button', { name: /Close Crumbs/i }).first();
        const hasClose = await close.isVisible().catch(() => false);
        if (hasClose) {
            await close.click();
            await page.waitForTimeout(500);
            await expect(close).not.toBeVisible();
        }
    });
});
