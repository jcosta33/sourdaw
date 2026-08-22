import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter LFO routing', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page.locator('.fermenter-faceplate').getByRole('button', { name: 'Envelopes', exact: true }).click();
    });

    test('ArrowUp steps LFO Pitch and Filter amounts 0 to 0.01', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        const pitch = panel.getByRole('slider', { name: '→ Pitch', exact: true });
        await expect(pitch).toHaveAttribute('aria-valuenow', '0');
        await pitch.scrollIntoViewIfNeeded();
        await pitch.press('ArrowUp');
        await expect(pitch).toHaveAttribute('aria-valuenow', '0.01');

        const filter = panel.getByRole('slider', { name: '→ Filter', exact: true });
        await expect(filter).toHaveAttribute('aria-valuenow', '0');
        await filter.scrollIntoViewIfNeeded();
        await filter.press('ArrowUp');
        await expect(filter).toHaveAttribute('aria-valuenow', '0.01');
    });
});
