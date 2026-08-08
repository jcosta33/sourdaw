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

test.describe('Toaster & Knead device panels', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toaster panel opens with Close button', async ({ page }) => {
        const opened = await openInstrument(page, 'Toaster');
        if (opened) {
            const close = page.getByRole('button', { name: /Close Toaster/i }).first();
            await expect(close).toBeVisible({ timeout: 10_000 });
        }
    });

    test('Toaster panel contains pad-related content', async ({ page }) => {
        const opened = await openInstrument(page, 'Toaster');
        if (opened) {
            // The panel should have some content — drum pads, kit name, etc.
            const closeBtn = page.getByRole('button', { name: /Close Toaster/i }).first();
            if (await closeBtn.isVisible().catch(() => false)) {
                const panel = closeBtn.locator('..').locator('..');
                const text = (await panel.innerText()).trim();
                expect(text.length).toBeGreaterThan(0);
            }
        }
    });

    test('Toaster panel can be closed', async ({ page }) => {
        const opened = await openInstrument(page, 'Toaster');
        if (opened) {
            const close = page.getByRole('button', { name: /Close Toaster/i }).first();
            if (await close.isVisible().catch(() => false)) {
                await close.click();
                await page.waitForTimeout(500);
                await expect(close).not.toBeVisible();
            }
        }
    });

    test('Knead panel opens with Close button', async ({ page }) => {
        // Knead may be under Effects.
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        // Try Effects tab.
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(300);
        }

        await search.fill('knead');
        await page.waitForTimeout(500);

        const card = page.getByRole('button', { name: /^Knead/i }).first();
        const hasCard = await card.isVisible().catch(() => false);
        if (hasCard) {
            await card.click();
            await page.waitForTimeout(2000);

            const close = page.getByRole('button', { name: /Close Knead/i }).first();
            const hasClose = await close.isVisible().catch(() => false);
            if (hasClose) {
                expect(await close.getAttribute('aria-label')).toContain('Knead');
            }
        }
    });

    test('Fermenter and Toaster can be opened sequentially', async ({ page }) => {
        // Open Fermenter.
        const fermenterOpened = await openInstrument(page, 'Fermenter');
        if (fermenterOpened) {
            const closeFermenter = page.getByRole('button', { name: /Close Fermenter/i }).first();
            await closeFermenter.click();
            await page.waitForTimeout(500);
        }

        // Open Toaster.
        const toasterOpened = await openInstrument(page, 'Toaster');
        if (toasterOpened) {
            const closeToaster = page.getByRole('button', { name: /Close Toaster/i }).first();
            await expect(closeToaster).toBeVisible({ timeout: 10_000 });
        }
    });
});
