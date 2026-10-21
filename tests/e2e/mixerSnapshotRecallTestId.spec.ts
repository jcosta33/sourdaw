import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

test.describe('Mixer snapshot recall — restores saved state', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        const dock = page.getByRole('button', { name: 'Toggle bottom dock', exact: true });
        if ((await dock.getAttribute('aria-pressed')) !== 'true') {
            await dock.click();
        }
        await expect(page.getByRole('region', { name: 'Mixer panel', exact: true })).toBeVisible();
    });

    test('recall restores the gain value saved in a snapshot', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel', exact: true });
        const kick = mixer.getByRole('group', { name: 'Kick channel', exact: true });
        const gainSlider = kick.getByRole('slider', { name: 'Kick gain', exact: true });
        const recallButton = mixer.getByRole('button', { name: 'Recall mixer snapshot', exact: true });

        await expect(gainSlider).toHaveAttribute('aria-valuenow', '0.8');
        await expect(recallButton).toBeDisabled();

        await mixer.getByRole('button', { name: 'Save mixer snapshot', exact: true }).click();
        await expect(recallButton).toBeEnabled();

        await gainSlider.press('Home');
        await expect(gainSlider).toHaveAttribute('aria-valuenow', '0');

        await recallButton.click();
        const savedSnapshot = mixer.getByRole('menu').getByRole('button', { name: 'Snapshot 1', exact: true });
        await expect(savedSnapshot).toBeVisible();
        await savedSnapshot.click();
        await expect(gainSlider).toHaveAttribute('aria-valuenow', '0.8');
    });
});
