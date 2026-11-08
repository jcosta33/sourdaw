import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenter(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
    }
    await expect(search).toBeVisible();
    await search.fill('fermenter');
    // The Fermenter card must be reachable; if it is not, the panel-open
    // contract is broken and the test must fail rather than silently skip.
    const card = page.getByRole('button', { name: /^Fermenter/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the Close control appears once FermenterPanel
    // has rendered, so wait on it instead of a fixed delay.
    await expect(page.getByRole('button', { name: /Close Fermenter/i }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Fermenter panel deep — knobs, macros', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Fermenter Brightness macro responds to keyboard at both bounds', async ({ page }) => {
        await openFermenter(page);

        const level = page.locator('.fermenter-faceplate').getByRole('slider', { name: 'Level', exact: true });
        await expect(level).toHaveAttribute('aria-valuenow', '0.8');
        await level.scrollIntoViewIfNeeded();
        await level.press('ArrowUp');
        await expect(level).toHaveAttribute('aria-valuenow', '0.81');

        const brightness = page
            .getByTestId('instrument-bottom-panel-body')
            .getByRole('slider', { name: 'Brightness', exact: true });
        await expect(brightness).toBeVisible();
        await brightness.focus();
        await page.keyboard.press('End');
        await expect(brightness).toHaveAttribute('aria-valuenow', '1');
        await page.keyboard.press('Home');
        await expect(brightness).toHaveAttribute('aria-valuenow', '0');
        await page.keyboard.press('ArrowUp');
        await expect(brightness).toHaveAttribute('aria-valuenow', '0.01');

        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('tab', { name: 'Effects', exact: true }).click();
        await expect(panel.getByRole('button', { name: 'Dist', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });

    test('Fermenter panel close button hides the panel', async ({ page }) => {
        await openFermenter(page);

        const close = page.getByRole('button', { name: /Close Fermenter/i }).first();
        await close.click();
        // Closing unmounts the panel: the Close control is gone (a real
        // visibility flip, not a static toBeVisible on an always-present node).
        await expect(close).toHaveCount(0);
    });

    test('Fermenter Macro combobox holds a value', async ({ page }) => {
        await openFermenter(page);

        // The Macro rig combobox is always present in the mounted Fermenter
        // panel; assert it holds a value rather than its mere existence.
        const macro = page.getByRole('combobox', { name: 'Macro' });
        await expect(macro).toBeVisible({ timeout: 5000 });
        const value = await macro.inputValue();
        expect(value.length).toBeGreaterThan(0);
    });
});
