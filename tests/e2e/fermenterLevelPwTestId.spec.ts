import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter oscillator Level', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('ArrowUp steps oscillator Level 0.8 to 0.81', async ({ page }) => {
        const level = page.locator('.fermenter-faceplate').getByRole('slider', { name: 'Level', exact: true });
        await expect(level).toHaveAttribute('aria-valuenow', '0.8');
        await level.scrollIntoViewIfNeeded();
        await level.press('ArrowUp');
        await expect(level).toHaveAttribute('aria-valuenow', '0.81');
    });
});
