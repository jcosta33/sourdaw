import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter envelope Attack and Sustain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page.locator('.fermenter-faceplate').getByRole('button', { name: 'Envelopes', exact: true }).click();
    });

    test('ArrowUp steps amp Attack 0.01 to 0.016 and Sustain 0.7 to 0.71', async ({ page }) => {
        const attack = page.getByRole('slider', { name: 'ampAttack', exact: true });
        await expect(attack).toHaveAttribute('aria-valuenow', '0.01');
        await attack.scrollIntoViewIfNeeded();
        await attack.press('ArrowUp');
        await expect(attack).toHaveAttribute('aria-valuenow', '0.016');

        const sustain = page.getByRole('slider', { name: 'ampSustain', exact: true });
        await expect(sustain).toHaveAttribute('aria-valuenow', '0.7');
        await sustain.scrollIntoViewIfNeeded();
        await sustain.press('ArrowUp');
        await expect(sustain).toHaveAttribute('aria-valuenow', '0.71');
    });
});
