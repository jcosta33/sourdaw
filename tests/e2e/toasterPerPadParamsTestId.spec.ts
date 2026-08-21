import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster per-pad Tone isolation', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('Kick Tone step does not change Snare Tone and survives reselect', async ({ page }) => {
        const kick = page.getByRole('button', { name: 'Trigger Kick', exact: true });
        const snare = page.getByRole('button', { name: 'Trigger Snare', exact: true });
        const tone = page.getByRole('slider', { name: 'Tone', exact: true });

        await expect(kick).toHaveAttribute('aria-pressed', 'true');
        await expect(tone).toHaveAttribute('aria-valuenow', '0.5');

        await tone.focus();
        await page.keyboard.press('ArrowUp');
        await expect(tone).toHaveAttribute('aria-valuenow', '0.51');

        await snare.click();
        await expect(snare).toHaveAttribute('aria-pressed', 'true');
        await expect(kick).toHaveAttribute('aria-pressed', 'false');
        await expect(tone).toHaveAttribute('aria-valuenow', '0.5');

        await kick.click();
        await expect(kick).toHaveAttribute('aria-pressed', 'true');
        await expect(tone).toHaveAttribute('aria-valuenow', '0.51');
    });
});
