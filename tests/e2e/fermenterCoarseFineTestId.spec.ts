import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter oscillator Coarse and Fine', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('ArrowUp steps Coarse from 0 to 1 and Fine from 0 to 0.1', async ({ page }) => {
        const coarse = page.getByRole('slider', { name: 'Coarse', exact: true });
        await expect(coarse).toHaveAttribute('aria-valuenow', '0');
        await coarse.scrollIntoViewIfNeeded();
        await coarse.press('ArrowUp');
        await expect(coarse).toHaveAttribute('aria-valuenow', '1');

        const fine = page.getByRole('slider', { name: 'Fine', exact: true });
        await expect(fine).toHaveAttribute('aria-valuenow', '0');
        await fine.scrollIntoViewIfNeeded();
        await fine.press('ArrowUp');
        await expect.poll(async () => Number(await fine.getAttribute('aria-valuenow'))).toBeCloseTo(0.1, 5);
    });
});
