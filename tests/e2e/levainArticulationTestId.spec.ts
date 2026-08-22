import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Levain/ }).click();
    await expect(page.getByRole('button', { name: 'Close Levain' })).toBeVisible({
        timeout: 30_000,
    });
}

test.describe('Levain articulation rail', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('Staccato takes the Long latch exclusively, then Close Levain unmounts the panel', async ({ page }) => {
        await expect(page.getByRole('status', { name: 'Engine ready' })).toBeVisible({ timeout: 30_000 });

        const rail = page.locator('section').filter({ hasText: 'Articulation rail' });
        const long = rail.getByRole('button', { name: 'Long C1' });
        const staccato = rail.getByRole('button', { name: 'Staccato F1' });

        await expect(long).toHaveAttribute('aria-pressed', 'true');
        await expect(staccato).not.toHaveAttribute('aria-pressed', 'true');

        await staccato.click();

        await expect(staccato).toHaveAttribute('aria-pressed', 'true');
        await expect(long).not.toHaveAttribute('aria-pressed', 'true');
        await expect(rail.locator('button[aria-pressed="true"]')).toHaveCount(1);

        const close = page.getByRole('button', { name: 'Close Levain' });
        await close.click();
        await expect(close).toHaveCount(0);
        await expect(rail).toHaveCount(0);
    });
});
