import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

async function closeInstrument(page: Page, instrument: string): Promise<void> {
    const closePanelButton = page.getByRole('button', { name: `Close ${instrument}` });
    await closePanelButton.focus();
    await page.keyboard.press('Enter');
    await expect(closePanelButton).toHaveCount(0);
}

test.describe('Toaster and Fermenter device panels', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toaster panel opens with Close button', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Toaster' });
        await expect(page.getByRole('textbox', { name: 'Search Toaster kits' })).toBeVisible();
    });

    test('Toaster panel contains pad-related content', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Toaster' });
        const pad0 = page.getByRole('button', { name: /^Trigger / }).nth(0);
        const pad1 = page.getByRole('button', { name: /^Trigger / }).nth(1);
        await expect(pad0).toBeVisible();
        await expect(pad1).toBeVisible();
        await pad1.click();
        await expect(pad1).toHaveAttribute('aria-pressed', 'true');
        await expect(pad0).toHaveAttribute('aria-pressed', 'false');
    });

    test('Toaster panel can be closed', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Toaster' });
        await expect(page.getByRole('textbox', { name: 'Search Toaster kits' })).toBeVisible();
        await closeInstrument(page, 'Toaster');
        await expect(page.getByRole('textbox', { name: 'Search Toaster kits' })).toHaveCount(0);
    });

    test('Fermenter and Toaster can be opened sequentially', async ({ page }) => {
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await expect(page.getByRole('combobox', { name: 'Macro' })).toBeVisible();
        await closeInstrument(page, 'Fermenter');
        await open_browser_instrument({ page, instrument: 'Toaster' });
        await expect(page.getByRole('textbox', { name: 'Search Toaster kits' })).toBeVisible();
    });
});
