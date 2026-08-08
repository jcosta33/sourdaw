import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Editing tools & ripple — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('select tool is the default active tool via test ID', async ({ page }) => {
        const select = page.getByTestId('tool-select');
        await expect(select).toBeVisible();
        await expect(select).toHaveAttribute('aria-checked', 'true');
    });

    test('switching to cut tool changes aria-checked via test ID', async ({ page }) => {
        const select = page.getByTestId('tool-select');
        const cut = page.getByTestId('tool-cut');

        await expect(select).toHaveAttribute('aria-checked', 'true');
        await expect(cut).toHaveAttribute('aria-checked', 'false');

        await cut.click();

        await expect(cut).toHaveAttribute('aria-checked', 'true');
        await expect(select).toHaveAttribute('aria-checked', 'false');
    });

    test('all 6 tools are present via test IDs', async ({ page }) => {
        const radiogroup = page.getByRole('radiogroup', { name: 'Editing tools' });
        await expect(radiogroup).toBeVisible({ timeout: 10_000 });

        for (const tool of ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee']) {
            await expect(page.getByTestId(`tool-${tool}`)).toBeVisible({ timeout: 10_000 });
        }
    });

    test('ripple editing toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const ripple = page.getByTestId('tool-ripple');
        await expect(ripple).toBeVisible();
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');

        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'true');

        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');
    });

    test('selecting draw tool then switching back to select', async ({ page }) => {
        const select = page.getByTestId('tool-select');
        const draw = page.getByTestId('tool-draw');

        await draw.click();
        await expect(draw).toHaveAttribute('aria-checked', 'true');
        await expect(select).toHaveAttribute('aria-checked', 'false');

        await select.click();
        await expect(select).toHaveAttribute('aria-checked', 'true');
        await expect(draw).toHaveAttribute('aria-checked', 'false');
    });
});
