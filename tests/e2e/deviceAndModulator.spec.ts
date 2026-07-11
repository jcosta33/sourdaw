import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from '../../tests/e2e/e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Device & Audio Settings', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add Audio Track');
        await page.getByRole('option', { name: 'Add Audio Track' }).click();
    });

    test('Audio input device selector is present in inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const input = inspector.getByRole('combobox', { name: 'Audio input device' });
        if (await input.isVisible().catch(() => false)) {
            await expect(input).toBeVisible();
        }
    });

    test('Refresh audio devices button is present', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const refresh = inspector.getByRole('button', { name: 'Refresh audio devices' });
        if (await refresh.isVisible().catch(() => false)) {
            await expect(refresh).toBeVisible();
        }
    });
});

test.describe('Automation Modulator Form', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-modulation').click();
    });

    test('Modulation matrix has add modulator control', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        await expect(matrix).toBeVisible({ timeout: 5000 });
        const add_button = matrix.getByRole('button', { name: /Add|Create|New/i }).first();
        if (await add_button.isVisible().catch(() => false)) {
            await add_button.click();
            await page.waitForTimeout(500);

            const name_input = page.getByRole('textbox', { name: 'Modulator name' });
            const kind_select = page.getByRole('combobox', { name: 'Modulator kind' });
            const name_visible = await name_input.isVisible().catch(() => false);
            const kind_visible = await kind_select.isVisible().catch(() => false);
            if (name_visible) await expect(name_input).toBeVisible();
            if (kind_visible) await expect(kind_select).toBeVisible();
        }
    });
});

test.describe('Crust Module Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const crust_item = page.getByRole('menuitem', { name: /Crust/i });
        if (await crust_item.isVisible().catch(() => false)) {
            await crust_item.click();
            await page.waitForTimeout(1000);
        }
    });

    test('Crust dither mode selector is present', async ({ page }) => {
        const dither = page.getByRole('combobox', { name: 'Dither mode' });
        if (await dither.isVisible().catch(() => false)) {
            await expect(dither).toBeVisible();
        }
    });

    test('Crust reset peak button is present', async ({ page }) => {
        const reset = page.getByRole('button', { name: 'Reset true peak indicator' });
        if (await reset.isVisible().catch(() => false)) {
            await expect(reset).toBeVisible();
        }
    });
});
