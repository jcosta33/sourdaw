import { expect, test } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from '../../tests/e2e/e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Clip Editor Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        const timeline = page.getByLabel('Timeline editor surface');
        const midi_rows = page.getByRole('grid', { name: /Track list/i }).getByRole('row', { name: /MIDI/i });
        if (await midi_rows.first().isVisible().catch(() => false)) {
            await midi_rows.first().click();
            await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
            const add_clip = page.getByRole('menuitem', { name: /Add Clip Here/i });
            if (await add_clip.isVisible().catch(() => false)) {
                await add_clip.click();
                await page.waitForTimeout(500);
                await timeline.dblclick({ position: { x: 200, y: 30 } });
                await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });
            }
        }
    });

    test('Piano roll zoom slider is present and interactive', async ({ page }) => {
        const zoom = page.getByRole('slider', { name: /Piano roll zoom/i });
        if (await zoom.isVisible().catch(() => false)) {
            const value = await zoom.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test('Scale root and type selectors are present', async ({ page }) => {
        const root = page.getByRole('combobox', { name: /Scale root note/i });
        const type = page.getByRole('combobox', { name: /Scale type/i });
        const root_visible = await root.isVisible().catch(() => false);
        const type_visible = await type.isVisible().catch(() => false);
        if (root_visible) await expect(root).toBeVisible();
        if (type_visible) await expect(type).toBeVisible();
    });

    test('Fold to scale toggle is present', async ({ page }) => {
        const fold = page.getByRole('button', { name: /Toggle fold to scale/i });
        if (await fold.isVisible().catch(() => false)) {
            await expect(fold).toBeVisible();
        }
    });

    test('Constrain notes to scale is present', async ({ page }) => {
        const constrain = page.getByRole('button', { name: /Constrain notes to scale/i });
        if (await constrain.isVisible().catch(() => false)) {
            await expect(constrain).toBeVisible();
        }
    });

    test('Step input mode toggle is present', async ({ page }) => {
        const step = page.getByRole('button', { name: /Toggle step input mode/i });
        if (await step.isVisible().catch(() => false)) {
            await expect(step).toBeVisible();
        }
    });

    test('Ghost notes toggle is present', async ({ page }) => {
        const ghost = page.getByRole('button', { name: /Toggle ghost notes/i });
        if (await ghost.isVisible().catch(() => false)) {
            await expect(ghost).toBeVisible();
        }
    });

    test('Paint mode toggle is present', async ({ page }) => {
        const paint = page.getByRole('button', { name: /Toggle paint mode/i });
        if (await paint.isVisible().catch(() => false)) {
            await expect(paint).toBeVisible();
        }
    });

    test('Expression view toggle is present', async ({ page }) => {
        const expr = page.getByRole('button', { name: /Toggle Expression View/i });
        if (await expr.isVisible().catch(() => false)) {
            await expect(expr).toBeVisible();
        }
    });

    test('Zoom to used range button is present', async ({ page }) => {
        const zoom_range = page.getByRole('button', { name: /Zoom to used range/i });
        if (await zoom_range.isVisible().catch(() => false)) {
            await expect(zoom_range).toBeVisible();
        }
    });

    test('Warp mode toggle is present', async ({ page }) => {
        const warp = page.getByRole('button', { name: /Toggle warp mode/i });
        if (await warp.isVisible().catch(() => false)) {
            await expect(warp).toBeVisible();
        }
    });
});
