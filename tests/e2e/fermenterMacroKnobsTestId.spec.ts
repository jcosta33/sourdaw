import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter Macro knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('ArrowUp steps Brightness, Width, and Character 0.5 to 0.51', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        for (const name of ['Brightness', 'Width', 'Character'] as const) {
            const knob = panel.getByRole('slider', { name, exact: true });
            await expect(knob).toHaveAttribute('aria-valuenow', '0.5');
            await knob.scrollIntoViewIfNeeded();
            await knob.press('ArrowUp');
            await expect(knob).toHaveAttribute('aria-valuenow', '0.51');
        }
    });
});
