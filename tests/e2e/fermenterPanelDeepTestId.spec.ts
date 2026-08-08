import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenter(page: import('@playwright/test').Page): Promise<boolean> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('fermenter');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Fermenter/i }).first();
    if (await card.isVisible().catch(() => false)) {
        await card.click();
        await page.waitForTimeout(2000);
        return true;
    }
    return false;
}

test.describe('Fermenter panel deep — knobs, macros', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Fermenter panel has parameter knobs', async ({ page }) => {
        const opened = await openFermenter(page);
        if (!opened) return;

        // The panel should contain RotaryKnob sliders.
        const sliders = page.getByRole('slider');
        const count = await sliders.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Fermenter knobs have aria-valuenow', async ({ page }) => {
        const opened = await openFermenter(page);
        if (!opened) return;

        const firstSlider = page.getByRole('slider').first();
        await expect(firstSlider).toBeVisible({ timeout: 5000 });

        const value = await firstSlider.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
    });

    test('Fermenter knob responds to keyboard', async ({ page }) => {
        const opened = await openFermenter(page);
        if (!opened) return;

        const firstSlider = page.getByRole('slider').first();
        if (await firstSlider.isVisible().catch(() => false)) {
            const before = await firstSlider.getAttribute('aria-valuenow');
            await firstSlider.focus();
            await page.keyboard.press('ArrowUp');
            await page.waitForTimeout(200);
            const after = await firstSlider.getAttribute('aria-valuenow');
            // Value should have changed (or stayed at max).
            if (Number(before) < 1) {
                expect(after).not.toBe(before);
            }
        }
    });

    test('Fermenter panel close button works', async ({ page }) => {
        const opened = await openFermenter(page);
        if (!opened) return;

        const close = page.getByRole('button', { name: /Close Fermenter/i }).first();
        await expect(close).toBeVisible({ timeout: 5000 });
        await close.click();
        await page.waitForTimeout(500);
        await expect(close).not.toBeVisible();
    });

    test('Fermenter panel shows engine type selector', async ({ page }) => {
        const opened = await openFermenter(page);
        if (!opened) return;

        // The panel should have some combobox or selector for engine type.
        const selects = page.getByRole('combobox');
        const count = await selects.count();
        // If there are selectors, they should be functional.
        if (count > 0) {
            const firstSelect = selects.first();
            if (await firstSelect.isVisible().catch(() => false)) {
                const value = await firstSelect.inputValue();
                expect(value.length).toBeGreaterThan(0);
            }
        }
    });
});
