import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openCrumbsSampler(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Crumbs/ }).click();
    await expect(page.getByRole('button', { name: 'Close Sampler' })).toBeVisible({
        timeout: 30_000,
    });
}

test.describe('Crumbs named knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openCrumbsSampler(page);
    });

    test('ArrowUp steps Atk 0.001 to 0.002, Gain 0.8 to 0.81, and Pan 0 to 0.01; ArrowDown steps Cutoff 20000 to 19990', async ({
        page,
    }) => {
        const panel = page.getByRole('button', { name: 'Close Sampler' }).locator('xpath=../..');

        const atk = panel.getByRole('slider', { name: 'Atk', exact: true });
        await expect(atk).toHaveAttribute('aria-valuenow', '0.001');
        await atk.scrollIntoViewIfNeeded();
        await atk.press('ArrowUp');
        await expect(atk).toHaveAttribute('aria-valuenow', '0.002');

        const cutoff = panel.getByRole('slider', { name: 'Cutoff', exact: true });
        await expect(cutoff).toHaveAttribute('aria-valuenow', '20000');
        await cutoff.scrollIntoViewIfNeeded();
        await cutoff.press('ArrowDown');
        await expect(cutoff).toHaveAttribute('aria-valuenow', '19990');

        const gain = panel.getByRole('slider', { name: 'Gain', exact: true });
        await expect(gain).toHaveAttribute('aria-valuenow', '0.8');
        await gain.scrollIntoViewIfNeeded();
        await gain.press('ArrowUp');
        await expect(gain).toHaveAttribute('aria-valuenow', '0.81');

        const pan = panel.getByRole('slider', { name: 'Pan', exact: true });
        await expect(pan).toHaveAttribute('aria-valuenow', '0');
        await pan.scrollIntoViewIfNeeded();
        await pan.press('ArrowUp');
        await expect(pan).toHaveAttribute('aria-valuenow', '0.01');
    });
});
