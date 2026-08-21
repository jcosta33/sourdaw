import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter FX Delay knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('button', { name: 'Effects', exact: true }).dispatchEvent('click');
        await panel.getByRole('button', { name: 'Delay', exact: true }).dispatchEvent('click');
    });

    test('ArrowUp steps Delay Time 375 to 376 and Feedback 0.35 to 0.36', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        const time = panel.getByRole('slider', { name: 'Time', exact: true });
        await expect(time).toHaveAttribute('aria-valuenow', '375');
        await time.scrollIntoViewIfNeeded();
        await time.press('ArrowUp');
        await expect(time).toHaveAttribute('aria-valuenow', '376');

        const feedback = panel.getByRole('slider', { name: 'Feedback', exact: true });
        await expect(feedback).toHaveAttribute('aria-valuenow', '0.35');
        await feedback.scrollIntoViewIfNeeded();
        await feedback.press('ArrowUp');
        await expect(feedback).toHaveAttribute('aria-valuenow', '0.36');
    });
});
