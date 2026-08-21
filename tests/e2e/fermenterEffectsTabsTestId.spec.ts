import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter Effects sub-tabs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('Comp swaps Dist Drive for Ratio and Dist restores Drive', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('button', { name: 'Effects', exact: true }).click();

        const distChip = panel.getByRole('button', { name: 'Dist', exact: true });
        const compChip = panel.getByRole('button', { name: 'Comp', exact: true });
        const drive = panel.getByRole('slider', { name: 'Drive', exact: true });
        const ratio = panel.getByRole('slider', { name: 'Ratio', exact: true });

        await expect(distChip).toHaveAttribute('aria-pressed', 'true');
        await expect(drive).toBeVisible();
        await expect(ratio).toHaveCount(0);

        await compChip.dispatchEvent('click');
        await expect(compChip).toHaveAttribute('aria-pressed', 'true');
        await expect(distChip).not.toHaveAttribute('aria-pressed', 'true');
        await expect(drive).toHaveCount(0);
        await expect(ratio).toBeVisible();

        await distChip.dispatchEvent('click');
        await expect(distChip).toHaveAttribute('aria-pressed', 'true');
        await expect(compChip).not.toHaveAttribute('aria-pressed', 'true');
        await expect(drive).toBeVisible();
        await expect(ratio).toHaveCount(0);
    });
});
