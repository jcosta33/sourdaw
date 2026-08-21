import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Level and Pan knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('ArrowUp steps Kick Level and Pan by 0.01', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Trigger Kick', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        const level = page.getByRole('slider', { name: 'Level', exact: true });
        await expect(level).toHaveAttribute('aria-valuenow', '0.8');
        await level.scrollIntoViewIfNeeded();
        await level.press('ArrowUp');
        await expect(level).toHaveAttribute('aria-valuenow', '0.81');

        const pan = page.getByRole('slider', { name: 'Pan', exact: true });
        await expect(pan).toHaveAttribute('aria-valuenow', '0');
        await pan.scrollIntoViewIfNeeded();
        await pan.press('ArrowUp');
        await expect(pan).toHaveAttribute('aria-valuenow', '0.01');
    });
});
