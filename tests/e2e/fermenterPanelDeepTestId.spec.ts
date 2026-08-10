import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenter(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('fermenter');
    await page.waitForTimeout(500);
    // The Fermenter card must be reachable; if it is not, the panel-open
    // contract is broken and the test must fail rather than silently skip.
    const card = page.getByRole('button', { name: /^Fermenter/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the Close control appears once FermenterPanel
    // has rendered, so wait on it instead of a fixed delay.
    await expect(page.getByRole('button', { name: /Close Fermenter/i }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Fermenter panel deep — knobs, macros', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Fermenter knob responds to keyboard — aria-valuenow changes on ArrowUp', async ({ page }) => {
        await openFermenter(page);

        const firstSlider = page.getByRole('slider').first();
        await expect(firstSlider).toBeVisible({ timeout: 5000 });
        await firstSlider.focus();
        const before = Number(await firstSlider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await firstSlider.getAttribute('aria-valuenow'));
        // The knob reports a new value unless it was already at its maximum.
        if (before < 1) {
            expect(after).toBeGreaterThan(before);
        }
    });

    test('Fermenter panel close button hides the panel', async ({ page }) => {
        await openFermenter(page);

        const close = page.getByRole('button', { name: /Close Fermenter/i }).first();
        await close.click();
        // Closing unmounts the panel: the Close control is gone (a real
        // visibility flip, not a static toBeVisible on an always-present node).
        await expect(close).toHaveCount(0);
    });

    test('Fermenter Macro combobox holds a value', async ({ page }) => {
        await openFermenter(page);

        // The Macro rig combobox is always present in the mounted Fermenter
        // panel; assert it holds a value rather than its mere existence.
        const macro = page.getByRole('combobox', { name: 'Macro' });
        await expect(macro).toBeVisible({ timeout: 5000 });
        const value = await macro.inputValue();
        expect(value.length).toBeGreaterThan(0);
    });
});
