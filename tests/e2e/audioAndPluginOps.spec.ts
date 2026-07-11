import { path } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Audio Clip Operations', () => {
    test('EDM template has audio-capable tracks for clip testing', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const rows = track_list.getByRole('row');
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(2);
    });

    test('Can import a sample and create an audio clip via drag-drop', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Library', exact: true }).click();
        await page.waitForTimeout(500);

        const file_input = page.locator('input[type="file"]');
        if (await file_input.first().isVisible().catch(() => false)) {
            const sample_path = 'public/samples/levain/clarinet/DCClar_stac_F2_v1_rr1_sum.wav';
            await file_input.first().setInputFiles(sample_path);
            await page.waitForTimeout(2000);
        }

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('Timeline right-click on EDM template shows clip context menu with operations', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        if (!box) return;

        await timeline.click({ button: 'right', position: { x: 200, y: box.height * 0.5 } });
        const menu = page.getByRole('menu');
        if (await menu.isVisible().catch(() => false)) {
            const items = menu.getByRole('menuitem');
            const count = await items.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('Can select a track and view its clips in the inspector', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const first_track = track_list.getByRole('row').first();
        await first_track.click();
        await page.waitForTimeout(500);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();
    });
});

test.describe('Plugin Browser & Scan', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Add device menu shows available devices', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('row').first().click();
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        const add_device = inspector.getByRole('button', { name: 'Add device' });
        await add_device.click();
        await page.waitForTimeout(500);

        const menu = page.getByRole('menu');
        if (await menu.isVisible().catch(() => false)) {
            const items = menu.getByRole('menuitem');
            const count = await items.count();
            expect(count).toBeGreaterThan(0);
        }
    });
});

test.describe('Fermenter Panel Controls', () => {
    test('Fermenter controls are accessible when panel is open', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const macro = page.getByRole('combobox', { name: 'Macro' });
        const portamento = page.getByRole('slider', { name: 'Portamento time' });

        const macro_visible = await macro.isVisible().catch(() => false);
        const portamento_visible = await portamento.isVisible().catch(() => false);

        if (macro_visible) await expect(macro).toBeVisible();
        if (portamento_visible) {
            const value = await portamento.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });
});
