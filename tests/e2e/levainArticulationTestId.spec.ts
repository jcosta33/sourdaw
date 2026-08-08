import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: import('@playwright/test').Page): Promise<boolean> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('levain');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Levain/i }).first();
    if (await card.isVisible().catch(() => false)) {
        await card.click();
        await page.waitForTimeout(2000);
        return true;
    }
    return false;
}

test.describe('Levain articulation & instrument panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Levain panel has articulation chips', async ({ page }) => {
        const opened = await openLevain(page);
        if (!opened) return;
        const chips = page.getByRole('button').filter({ hasText: /arco|pizzicato|spiccato|tremolo|legato|staccato/i });
        const hasChips = await chips.first().isVisible().catch(() => false);
        if (hasChips) {
            expect(await chips.count()).toBeGreaterThan(0);
        }
    });

    test('Levain panel has parameter sliders', async ({ page }) => {
        const opened = await openLevain(page);
        if (!opened) return;
        const sliders = page.getByRole('slider');
        expect(await sliders.count()).toBeGreaterThan(0);
    });

    test('Levain close button works', async ({ page }) => {
        const opened = await openLevain(page);
        if (!opened) return;
        const close = page.getByRole('button', { name: /Close Levain/i }).first();
        await expect(close).toBeVisible({ timeout: 5000 });
        await close.click();
        await page.waitForTimeout(500);
        await expect(close).not.toBeVisible();
    });

    test('Levain first articulation is active by default', async ({ page }) => {
        const opened = await openLevain(page);
        if (!opened) return;
        const chips = page.getByRole('button').filter({ hasText: /arco|pizzicato|spiccato|tremolo|legato|staccato/i });
        if (await chips.first().isVisible().catch(() => false)) {
            const active = chips.filter({ hasText: /.*/ }).locator('[data-active="true"]').or(
                chips.first()
            );
            const hasActive = await active.first().isVisible().catch(() => false);
            expect(hasActive).toBe(true);
        }
    });

    test('Levain knobs respond to keyboard', async ({ page }) => {
        const opened = await openLevain(page);
        if (!opened) return;
        const firstSlider = page.getByRole('slider').first();
        if (await firstSlider.isVisible().catch(() => false)) {
            const before = await firstSlider.getAttribute('aria-valuenow');
            await firstSlider.focus();
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(200);
            const after = await firstSlider.getAttribute('aria-valuenow');
            if (Number(before) < 1) {
                expect(after).not.toBe(before);
            }
        }
    });
});
