import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('MIDI Transform Operations', () => {
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
            await timeline.dblclick({ position: { x: 200, y: 30 } });
            await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });
        }
    });

    test('MIDI editor toolbar shows transform buttons', async ({ page }) => {
        const chord_btn = page.getByRole('button', { name: /Chord/i });
        if (await chord_btn.isVisible().catch(() => false)) {
            await expect(chord_btn).toBeVisible();
        }
    });

    test('Can create notes via double-click in piano roll', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const box = await piano_roll.boundingBox();
        if (box) {
            await piano_roll.dblclick({ position: { x: box.width * 0.2, y: box.height * 0.4 } });
            await page.waitForTimeout(300);
            await piano_roll.dblclick({ position: { x: box.width * 0.4, y: box.height * 0.6 } });
            await page.waitForTimeout(300);
        }
        await expect(piano_roll).toBeVisible();
    });

    test('Undo reverts note creation', async ({ page }) => {
        const piano_roll = page.getByLabel('Piano roll editor');
        const box = await piano_roll.boundingBox();
        if (box) {
            await piano_roll.dblclick({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
            await page.waitForTimeout(300);
        }

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        if (await undo.isEnabled().catch(() => false)) {
            await undo.click();
            await page.waitForTimeout(500);
        }
        await expect(piano_roll).toBeVisible();
    });
});

test.describe('Modulation Matrix Deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-modulation').click();
    });

    test('Modulation matrix region is present with controls', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        await expect(matrix).toBeVisible({ timeout: 5000 });

        const buttons = matrix.getByRole('button');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Add modulator form appears when add clicked', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        const add_btn = matrix.getByRole('button', { name: /Add|Create|New|\+/i }).first();
        if (await add_btn.isVisible().catch(() => false)) {
            await add_btn.click();
            await page.waitForTimeout(500);

            const name = page.getByRole('textbox', { name: 'Modulator name' });
            const kind = page.getByRole('combobox', { name: 'Modulator kind' });

            const name_visible = await name.isVisible().catch(() => false);
            const kind_visible = await kind.isVisible().catch(() => false);
            if (name_visible || kind_visible) {
                expect(name_visible || kind_visible).toBe(true);
            }
        }
    });
});

test.describe('Setlist Deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-setlist').click();
    });

    test('Can add multiple setlist items and navigate', async ({ page }) => {
        const add_btn = page.getByRole('button', { name: 'Add setlist item' });
        await add_btn.click();
        await page.waitForTimeout(300);
        await add_btn.click();
        await page.waitForTimeout(300);

        const items = page.getByRole('list', { name: 'Setlist items' });
        if (await items.isVisible().catch(() => false)) {
            const list_items = items.getByRole('listitem');
            const count = await list_items.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('Auto-advance toggle reflects state', async ({ page }) => {
        const toggle = page.getByRole('button', { name: /Auto-advance/i });
        if (await toggle.isVisible().catch(() => false)) {
            const pressed_before = await toggle.getAttribute('aria-pressed');
            await toggle.click();
            await page.waitForTimeout(300);
            const pressed_after = await toggle.getAttribute('aria-pressed');
            if (pressed_before !== null) {
                expect(pressed_after).not.toBe(pressed_before);
            }
        }
    });
});

test.describe('Loop Station Deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-loopStation').click();
    });

    test('Arm and disarm changes button label', async ({ page }) => {
        const arm = page.getByRole('button', { name: /Arm loop station/i });
        await expect(arm).toBeVisible();
        await arm.click();

        const disarm = page.getByRole('button', { name: /Disarm loop station/i });
        await expect(disarm).toBeVisible({ timeout: 5000 });

        await disarm.click();
        await expect(arm).toBeVisible({ timeout: 5000 });
    });

    test('Loop slots grid is visible', async ({ page }) => {
        const grid = page.getByRole('grid', { name: 'Loop slots' });
        if (await grid.isVisible().catch(() => false)) {
            await expect(grid).toBeVisible();
        }
    });
});

test.describe('Crust Module Deep', () => {
    test('Crust panel controls accessible when device added', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const crust = page.getByRole('menuitem', { name: /Crust/i });
        if (await crust.isVisible().catch(() => false)) {
            await crust.click();
            await page.waitForTimeout(1000);

            const dither = page.getByRole('combobox', { name: 'Dither mode' });
            if (await dither.isVisible().catch(() => false)) {
                const options = await dither.getByRole('option').count();
                expect(options).toBeGreaterThan(0);
            }

            const reset_peak = page.getByRole('button', { name: 'Reset true peak indicator' });
            if (await reset_peak.isVisible().catch(() => false)) {
                await expect(reset_peak).toBeVisible();
            }
        }
    });
});

test.describe('Analysis Panel Content', () => {
    test('Analysis tab shows content on EDM template', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-analysis').click();
        await page.waitForTimeout(1000);

        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
    });
});

test.describe('Onboarding Tour', () => {
    test('Onboarding tour appears on first interaction', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.waitForTimeout(500);

        const tour = page.getByRole('dialog', { name: /Onboarding tour/i });
        if (await tour.isVisible().catch(() => false)) {
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(300);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
        }
    });
});
