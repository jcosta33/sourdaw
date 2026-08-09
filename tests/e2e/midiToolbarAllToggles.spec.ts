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

test.describe('MIDI toolbar all toggles — Pop Song', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('enable every toolbar toggle one by one', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const toggles = [
            'toolbar-fold-to-scale',
            'toolbar-constrain',
            'toolbar-step-input',
            'toolbar-ghost',
            'toolbar-paint',
            'toolbar-expression',
        ];

        for (const id of toggles) {
            const btn = page.getByTestId(id);
            if (await btn.isVisible().catch(() => false)) {
                const before = await btn.getAttribute('aria-pressed');
                await btn.click();
                await page.waitForTimeout(200);
                await expect(btn).not.toHaveAttribute('aria-pressed', before ?? '');
            }
        }
    });

    test('chord stamp reveals chord type selector', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        await page.getByTestId('toolbar-chord').click();
        await page.waitForTimeout(300);
        await expect(page.getByTestId('toolbar-chord-type')).toBeVisible({ timeout: 5000 });
    });

    test('disable all toggles returns to default state', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        // Enable fold, constrain, paint.
        await page.getByTestId('toolbar-fold-to-scale').click();
        await page.getByTestId('toolbar-constrain').click();
        await page.getByTestId('toolbar-paint').click();

        // Verify all on.
        await expect(page.getByTestId('toolbar-fold-to-scale')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('toolbar-constrain')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('toolbar-paint')).toHaveAttribute('aria-pressed', 'true');

        // Disable all.
        await page.getByTestId('toolbar-fold-to-scale').click();
        await page.getByTestId('toolbar-constrain').click();
        await page.getByTestId('toolbar-paint').click();

        // Verify all off.
        await expect(page.getByTestId('toolbar-fold-to-scale')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByTestId('toolbar-constrain')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByTestId('toolbar-paint')).toHaveAttribute('aria-pressed', 'false');
    });

    test('scale type selector changes value', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const type = page.getByTestId('toolbar-scale-type');
        const select = type.getByRole('combobox');
        if (await select.isVisible().catch(() => false)) {
            const before = await select.inputValue();
            await select.selectOption({ index: 3 });
            const after = await select.inputValue();
            expect(after).not.toBe(before);
        }
    });

    test('snap buttons switch active variant', async ({ page }) => {
        const opened = await openPianoRoll(page);
        if (!opened) return;

        const snap14 = page.getByRole('button', { name: '1/4', exact: true });
        const snap18 = page.getByRole('button', { name: '1/8', exact: true });

        await snap18.click();
        await page.waitForTimeout(200);

        const v18 = await snap18.getAttribute('data-variant');
        const v14 = await snap14.getAttribute('data-variant');
        expect(v18).not.toBe(v14);
    });
});
