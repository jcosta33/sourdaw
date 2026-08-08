import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Solo mode selector — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('SIP is the default solo mode via test ID', async ({ page }) => {
        const sip = page.getByTestId('solo-mode-sip');
        await expect(sip).toBeVisible({ timeout: 10_000 });
        await expect(sip).toHaveAttribute('aria-checked', 'true');
    });

    test('all 3 solo modes are present via test IDs', async ({ page }) => {
        const radiogroup = page.getByRole('radiogroup', { name: 'Solo mode' });
        await expect(radiogroup).toBeVisible({ timeout: 10_000 });

        for (const mode of ['sip', 'afl', 'pfl']) {
            await expect(page.getByTestId(`solo-mode-${mode}`)).toBeVisible({ timeout: 10_000 });
        }
    });

    test('switching from SIP to AFL changes aria-checked via test ID', async ({ page }) => {
        const sip = page.getByTestId('solo-mode-sip');
        const afl = page.getByTestId('solo-mode-afl');

        await expect(sip).toHaveAttribute('aria-checked', 'true');
        await expect(afl).toHaveAttribute('aria-checked', 'false');

        await afl.click();

        await expect(afl).toHaveAttribute('aria-checked', 'true');
        await expect(sip).toHaveAttribute('aria-checked', 'false');
    });

    test('cycling SIP → AFL → PFL → SIP', async ({ page }) => {
        const sip = page.getByTestId('solo-mode-sip');
        const afl = page.getByTestId('solo-mode-afl');
        const pfl = page.getByTestId('solo-mode-pfl');

        await afl.click();
        await expect(afl).toHaveAttribute('aria-checked', 'true');

        await pfl.click();
        await expect(pfl).toHaveAttribute('aria-checked', 'true');
        await expect(afl).toHaveAttribute('aria-checked', 'false');

        await sip.click();
        await expect(sip).toHaveAttribute('aria-checked', 'true');
        await expect(pfl).toHaveAttribute('aria-checked', 'false');
    });
});
