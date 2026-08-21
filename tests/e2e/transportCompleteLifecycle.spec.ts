import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Metronome volume arm', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();
    });

    test('enabling metronome mounts volume and disabling removes it', async ({ page }) => {
        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        const volume = page.getByRole('slider', { name: /^Metronome volume:/ });

        await expect(volume).toHaveCount(0);

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');
        await expect(volume).toBeVisible();
        await expect(volume).toHaveAttribute('aria-valuenow', '0.5');

        await volume.focus();
        await page.keyboard.press('ArrowRight');
        await expect(volume).not.toHaveAttribute('aria-valuenow', '0.5');

        await metronome.click();
        await expect(metronome).not.toHaveAttribute('aria-pressed', 'true');
        await expect(volume).toHaveCount(0);
    });
});
