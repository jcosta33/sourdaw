import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Automation mode selection: the mode button (data-testid="automation-mode-button")
// carries aria-label="Automation mode: <mode>" and shows the mode label text.
// The existing automation test only asserts the dropdown LISTS the options.
// This asserts selecting a mode changes the button's aria-label + label text.
test.describe('Automation mode selection — button label changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        if (!/true/i.test((await dock.getAttribute('aria-pressed')) ?? '')) {
            await dock.click();
        }
        await page.locator('#bottom-dock-tab-automation').click();
        await page.waitForTimeout(400);
    });

    test('selecting Touch mode changes the button aria-label and text', async ({ page }) => {
        const modeButton = page.getByTestId('automation-mode-button');
        await expect(modeButton).toBeVisible({ timeout: 10_000 });

        // Capture the default mode (Read).
        const labelBefore = (await modeButton.innerText()).trim();
        const ariaBefore = await modeButton.getAttribute('aria-label');

        // Open the mode dropdown.
        await modeButton.click();
        await page.waitForTimeout(300);

        // Select Touch — the dropdown options are plain buttons.
        const touchOption = page.getByRole('button', { name: 'Touch', exact: true }).first();
        await expect(touchOption).toBeVisible({ timeout: 5000 });
        await touchOption.click();
        await page.waitForTimeout(300);

        // The button's label and aria-label changed — a real mode-swap.
        const labelAfter = (await modeButton.innerText()).trim();
        const ariaAfter = await modeButton.getAttribute('aria-label');
        expect(labelAfter).not.toBe(labelBefore);
        expect(ariaAfter).toContain('touch');
    });
});
