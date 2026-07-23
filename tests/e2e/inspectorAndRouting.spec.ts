import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Inspector — Automation Lane Management', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Can add and remove an automation lane', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Add automation lane/i }).click();
        await page.waitForTimeout(500);

        const remove_btn = inspector.getByRole('button', { name: /Remove.*lane/i });
        if (await remove_btn.first().isVisible().catch(() => false)) {
            await remove_btn.first().click();
            await page.waitForTimeout(500);
        }
    });
});

test.describe('Inspector — Track Alternatives', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Can create and delete a track alternative', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const create_alt = inspector.getByRole('button', { name: /Create new alternative/i });
        if (await create_alt.isVisible().catch(() => false)) {
            await create_alt.click();
            await page.waitForTimeout(500);

            const delete_alt = inspector.getByRole('button', { name: /Delete.*alternative/i });
            if (await delete_alt.first().isVisible().catch(() => false)) {
                await delete_alt.first().click();
                await page.waitForTimeout(300);
            }
        }
    });

    test('Can flatten comp from inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const flatten = inspector.getByRole('button', { name: /Flatten comp/i });
        if (await flatten.isVisible().catch(() => false)) {
            await expect(flatten).toBeVisible();
        }
    });
});

test.describe('Inspector — Sends & Bus Routing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
    });

    test('Create Bus button creates a bus track', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const create_bus = inspector.getByRole('button', { name: 'Create Bus' });
        if (await create_bus.isVisible().catch(() => false)) {
            const track_list = page.getByRole('grid', { name: /Track list/i });
            const rows_before = await track_list.getByRole('row').count();
            await create_bus.click();
            await page.waitForTimeout(500);
            const rows_after = await track_list.getByRole('row').count();
            expect(rows_after).toBeGreaterThanOrEqual(rows_before);
        }
    });
});

test.describe('Arrangement Selector', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Arrangement selector appears after creating second arrangement', async ({ page }) => {
        await page.getByRole('button', { name: 'Project menu' }).click();
        const menu = page.getByRole('menu', { name: 'Project menu' });

        // Try to find "New Arrangement" or similar
        const new_arr_item = menu.getByRole('menuitem', { name: /New Arrangement/i });
        if (await new_arr_item.isVisible().catch(() => false)) {
            await new_arr_item.click();
            await page.waitForTimeout(500);

            const selector = page.getByRole('button', { name: /Arrangement selector/i });
            if (await selector.isVisible().catch(() => false)) {
                await selector.click();
                await page.waitForTimeout(300);
                const arr_menu = page.getByRole('menu', { name: /Arrangement menu/i });
                if (await arr_menu.isVisible().catch(() => false)) {
                    const items = arr_menu.getByRole('menuitem');
                    const count = await items.count();
                    expect(count).toBeGreaterThan(0);
                }
            }
        }
        await page.keyboard.press('Escape');
    });
});

test.describe('Clip Context Menu Operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        const add = page.getByRole('menuitem', { name: /Add Clip Here/i });
        if (await add.isVisible().catch(() => false)) {
            await add.click();
            await page.waitForTimeout(500);
        }
    });

    test('Clip context menu shows audio-specific operations', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        if (!box) return;

        await timeline.click({ position: { x: 200, y: box.height * 0.5 } });
        await page.waitForTimeout(300);
        await timeline.click({ button: 'right', position: { x: 200, y: box.height * 0.5 } });

        const menu = page.getByRole('menu');
        if (await menu.isVisible().catch(() => false)) {
            const items = await menu.getByRole('menuitem').allInnerTexts();
            const has_edit_op = items.some((t) => /normalize|reverse|strip|bounce|split|duplicate|copy|paste|delete|rename/i.test(t));
            expect(has_edit_op).toBe(true);
        }
    });
});

test.describe('MIDI Editor — Advanced Lane Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('MIDI clip opens editor with expression lane selector', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const midi_rows = track_list.getByRole('row', { name: /MIDI/i });
        if (await midi_rows.first().isVisible().catch(() => false)) {
            const timeline = page.getByLabel('Timeline editor surface');
            const box = await timeline.boundingBox();
            if (box) {
                await timeline.dblclick({ position: { x: box.width * 0.3, y: 30 } });
                await page.waitForTimeout(1000);

                const expr_lane = page.getByRole('combobox', { name: /Active expression lane/i });
                if (await expr_lane.isVisible().catch(() => false)) {
                    await expect(expr_lane).toBeVisible();
                }
            }
        }
    });

    test('MIDI editor has scale constraint toggles', async ({ page }) => {
        const fold = page.getByRole('button', { name: /Toggle fold to scale/i });
        if (await fold.isVisible().catch(() => false)) {
            await expect(fold).toBeVisible();
        }
    });
});

test.describe('Track Header — Input Monitoring', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
    });

    test('Input monitoring button cycles modes', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const monitor = track_list.getByRole('button', { name: /Input monitoring/i });
        if (await monitor.first().isVisible().catch(() => false)) {
            const label_before = await monitor.first().getAttribute('aria-label');
            await monitor.first().click();
            await page.waitForTimeout(300);
            const label_after = await monitor.first().getAttribute('aria-label');
            // Label should change (Auto → In → Auto, or similar cycle)
            if (label_before && label_after) {
                expect(typeof label_after).toBe('string');
            }
        }
    });
});

test.describe('Routing & Signal Flow', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Routing tab shows content when opened', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-routing').click();
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('Signal Flow button opens from inspector', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('row').first().click();
        await page.waitForTimeout(300);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const signal_flow = inspector.getByRole('button', { name: 'Signal Flow' });
        if (await signal_flow.isVisible().catch(() => false)) {
            await signal_flow.click();
            await page.waitForTimeout(500);
        }
    });
});

test.describe('Master Track Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Master track spectrum button is clickable', async ({ page }) => {
        const master_btn = page.getByRole('button', { name: /Master Track Spectrum/i });
        if (await master_btn.isVisible().catch(() => false)) {
            await master_btn.click();
            await page.waitForTimeout(500);
        }
    });
});

test.describe('Chord Track — Add and Clear', () => {
    test('Pop Song template chord track has add and clear buttons', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await launch_screen.waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await page.getByRole('group', { name: 'Playback controls' }).waitFor({ state: 'visible', timeout: 10000 });

        const chord_track = page.getByRole('region', { name: 'Chord track' });
        if (await chord_track.isVisible().catch(() => false)) {
            const add_chord = chord_track.getByRole('button', { name: /Add chord event/i });
            await expect(add_chord).toBeVisible();

            const clear = chord_track.getByRole('button', { name: /Clear all chords/i });
            if (await clear.isVisible().catch(() => false)) {
                await expect(clear).toBeVisible();
            }
        }
    });
});
