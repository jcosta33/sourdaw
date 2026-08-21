import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Automation mode selection — button label changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await openBottomTab(page, 'Automation');
    });

    test('selecting Touch mode changes the button aria-label and text', async ({ page }) => {
        const modeButton = page.getByRole('button', { name: /Automation mode/ });
        await expect(modeButton).toBeVisible();
        await expect(modeButton).toHaveAttribute('data-testid', 'automation-mode-button');
        await expect(modeButton).toHaveText('R');
        await expect(modeButton).toHaveAttribute('aria-label', 'Automation mode: read');

        await expect(page.getByRole('button', { name: 'Touch', exact: true })).toHaveCount(0);
        await modeButton.click();
        const touchOption = page.getByRole('button', { name: 'Touch', exact: true });
        await expect(touchOption).toBeVisible();
        await touchOption.click();

        await expect(modeButton).toHaveText('TCH');
        await expect(modeButton).toHaveAttribute('aria-label', 'Automation mode: touch');
        await expect(touchOption).toHaveCount(0);
    });
});
