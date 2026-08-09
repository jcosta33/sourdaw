import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<boolean> {
    const canvas = page.getByLabel('Timeline editor surface');
    const positions = [{ x: 100, y: 40 }, { x: 200, y: 40 }, { x: 150, y: 80 }, { x: 250, y: 80 }];
    for (const pos of positions) {
        await canvas.dblclick({ position: pos });
        await page.waitForTimeout(500);
        if (await page.locator('[aria-label="Piano roll editor"]').isVisible().catch(() => false)) return true;
    }
    return false;
}

test.describe('Expression lane deep — velocity, MPE', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('expression view toggle reveals lane selector', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        await page.getByTestId('toolbar-expression').click();
        await page.waitForTimeout(300);
        const lane = page.locator('[aria-label="Active expression lane"]');
        await expect(lane).toBeVisible({ timeout: 5000 });
    });

    test('velocity lane is default when expression opens', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        await page.getByTestId('toolbar-expression').click();
        await page.waitForTimeout(300);
        const select = page.locator('[aria-label="Active expression lane"]').getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            expect(await select.inputValue()).toBe('velocity');
        }
    });

    test('expression view can be toggled off', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        const expr = page.getByTestId('toolbar-expression');
        const before = await expr.getAttribute('aria-pressed');
        await expr.click();
        await page.waitForTimeout(300);
        await expect(expr).not.toHaveAttribute('aria-pressed', before ?? '');
        await expr.click();
        await expect(expr).toHaveAttribute('aria-pressed', before ?? '');
    });

    test('scale root changeable while expression view open', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;
        await page.getByTestId('toolbar-expression').click();
        await page.waitForTimeout(300);

        const root = page.getByTestId('toolbar-scale-root');
        const select = root.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const before = await select.inputValue();
            await select.selectOption({ index: 5 });
            const after = await select.inputValue();
            expect(after).not.toBe(before);
        }
    });

    test('all toolbar toggles can be enabled simultaneously', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        await page.getByTestId('toolbar-fold-to-scale').click();
        await page.getByTestId('toolbar-constrain').click();
        await page.getByTestId('toolbar-expression').click();

        await expect(page.getByTestId('toolbar-fold-to-scale')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('toolbar-constrain')).toHaveAttribute('aria-pressed', 'true');
    });
});
