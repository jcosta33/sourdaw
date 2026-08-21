import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openMixer(page: Page): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock', exact: true });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    await expect(page.getByRole('region', { name: 'Mixer panel', exact: true })).toBeVisible();
}

test.describe('Master channel strip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openMixer(page);
    });

    test('master gain steps down from 0.8 with ArrowDown', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel', exact: true });
        const gain = mixer.getByTestId('master-gain').getByRole('slider', { name: 'Master gain', exact: true });
        await expect(gain).toBeAttached();
        await expect(gain).toHaveAttribute('aria-valuenow', '0.8');
        await gain.focus();
        await page.keyboard.press('ArrowDown');
        await expect(gain).toHaveAttribute('aria-valuenow', '0.79');
    });
});
