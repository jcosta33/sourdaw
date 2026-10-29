import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openBakery(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

test.describe('Bakery control geometry', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('the dither Off choice activates and remains selected after reopening', async ({ page }) => {
        await openBakery(page);

        const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        const off = dialog.getByRole('button', { name: 'Off', exact: true });
        await off.click();
        await expect
            .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sourdaw:export-settings') ?? '{}').dither))
            .toBe('none');

        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await openBakery(page);

        const selectedBackground = await dialog
            .getByRole('button', { name: 'Off', exact: true })
            .evaluate((element) => getComputedStyle(element).backgroundColor);
        const unselectedBackground = await dialog
            .getByRole('button', { name: 'Repeatable', exact: true })
            .evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(selectedBackground).not.toBe(unselectedBackground);
    });

    test('all Fidelity controls remain reachable by scrolling the dialog', async ({ page }) => {
        await openBakery(page);

        const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        const repeatable = dialog.getByRole('button', { name: 'Repeatable', exact: true });
        await expect(repeatable).toBeEnabled();

        const dialogBox = await dialog.boundingBox();
        if (!dialogBox) {
            throw new Error('Bakery dialog bounding box not available');
        }

        const readScrollablePositions = async (): Promise<number[]> =>
            dialog.evaluate((dialogElement) => {
                const elements = [dialogElement, ...dialogElement.querySelectorAll('*')];
                return elements
                    .filter((element) => {
                        const { overflowY } = getComputedStyle(element);
                        return (
                            (overflowY === 'auto' || overflowY === 'scroll') &&
                            element.scrollHeight > element.clientHeight
                        );
                    })
                    .map((element) => element.scrollTop);
            });

        await page.mouse.move(dialogBox.x + dialogBox.width / 2, dialogBox.y + dialogBox.height / 2);
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const isReachable = await repeatable.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const viewportHeight = document.documentElement.clientHeight;
                const viewportWidth = document.documentElement.clientWidth;
                return (
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= viewportHeight &&
                    rect.right <= viewportWidth &&
                    element.getClientRects().length > 0
                );
            });
            if (isReachable) {
                break;
            }
            await page.mouse.wheel(0, 500);
        }

        expect((await readScrollablePositions()).some((scrollTop) => scrollTop > 0)).toBe(true);
        await repeatable.click({ timeout: 2_000 });
        await expect
            .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sourdaw:export-settings') ?? '{}').dither))
            .toBe('seeded');
    });
});
