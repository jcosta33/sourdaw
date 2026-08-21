import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const PANEL_OPEN_TIMEOUT_MS = 30_000;

async function openCrumbsSampler(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Crumbs/ }).click();
    await expect(page.getByRole('button', { name: 'Close Sampler' })).toBeVisible({
        timeout: PANEL_OPEN_TIMEOUT_MS,
    });
}

test.describe('Crumbs sampler panel', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openCrumbsSampler(page);
    });

    test('switching to Drum shows empty Pad 1 and deselects Quick', async ({ page }) => {
        const quick = page.getByRole('button', { name: 'Quick', exact: true });
        const drum = page.getByRole('button', { name: 'Drum', exact: true });
        const pad1 = page.getByRole('button', { name: 'Pad 1 (empty)', exact: true });

        await expect(quick).toHaveAttribute('aria-pressed', 'true');
        await expect(drum).not.toHaveAttribute('aria-pressed', 'true');
        await expect(pad1).toHaveCount(0);

        await drum.click();

        await expect(drum).toHaveAttribute('aria-pressed', 'true');
        await expect(quick).not.toHaveAttribute('aria-pressed', 'true');
        await expect(pad1).toBeVisible();
    });

    test('Atk slider exposes a numeric value that keyboard input can raise', async ({ page }) => {
        const atk = page.getByRole('slider', { name: 'Atk', exact: true });
        await expect(atk).toBeVisible();

        const before = Number(await atk.getAttribute('aria-valuenow'));
        expect(Number.isFinite(before)).toBe(true);

        await atk.focus();
        await page.keyboard.press('ArrowRight');
        await expect(atk).not.toHaveAttribute('aria-valuenow', String(before));
        const after = Number(await atk.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
