import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

async function stepKitKnob(
    page: Page,
    name: string,
    from: string,
    key: 'ArrowUp' | 'ArrowDown',
    to: string
): Promise<void> {
    const knob = page.getByRole('slider', { name, exact: true });
    await expect(knob).toHaveAttribute('aria-valuenow', from);
    await knob.scrollIntoViewIfNeeded();
    await knob.press(key);
    await expect(knob).toHaveAttribute('aria-valuenow', to);
}

test.describe('Toaster Groove kit knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('Swing Space Spray Dust step up and Bits steps down', async ({ page }) => {
        await stepKitKnob(page, 'Swing', '0', 'ArrowUp', '0.01');
        await stepKitKnob(page, 'Space', '0.15', 'ArrowUp', '0.16');
        await stepKitKnob(page, 'Spray', '0', 'ArrowUp', '0.01');
        await stepKitKnob(page, 'Dust', '0', 'ArrowUp', '0.01');
        await stepKitKnob(page, 'Bits', '16', 'ArrowDown', '15');
    });
});
