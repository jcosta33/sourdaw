import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster pad interaction', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('default kit mounts sixteen named pads with Kick selected', async ({ page }) => {
        const kick = page.getByRole('button', { name: 'Trigger Kick', exact: true });
        const snare = page.getByRole('button', { name: 'Trigger Snare', exact: true });

        await expect(kick).toBeVisible();
        await expect(page.getByRole('button', { name: /^Trigger / })).toHaveCount(16);
        await expect(kick).toHaveAttribute('aria-pressed', 'true');
        await expect(snare).toHaveAttribute('aria-pressed', 'false');
    });

    test('clicking Snare selects it and deselects Kick', async ({ page }) => {
        const kick = page.getByRole('button', { name: 'Trigger Kick', exact: true });
        const snare = page.getByRole('button', { name: 'Trigger Snare', exact: true });

        await expect(kick).toHaveAttribute('aria-pressed', 'true');
        await snare.click();
        await expect(snare).toHaveAttribute('aria-pressed', 'true');
        await expect(kick).toHaveAttribute('aria-pressed', 'false');
    });
});
