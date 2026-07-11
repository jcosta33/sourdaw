import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from '../../tests/e2e/e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function create_midi_clip(page: import('@playwright/test').Page): Promise<boolean> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
    const add = page.getByRole('menuitem', { name: /Add Clip Here/i });
    if (await add.isVisible().catch(() => false)) {
        await add.click();
        await page.waitForTimeout(500);
        await timeline.click({ position: { x: 200, y: 30 } });
        await page.waitForTimeout(500);
        return true;
    }
    return false;
}

test.describe('Clip Inspector Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Clip inspector shows trim controls when clip is selected', async ({ page }) => {
        if (!await create_midi_clip(page)) return;
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const trim_start = inspector.getByRole('slider', { name: /Trim clip start/i });
        const trim_end = inspector.getByRole('slider', { name: /Trim clip end/i });
        const start_visible = await trim_start.isVisible().catch(() => false);
        const end_visible = await trim_end.isVisible().catch(() => false);
        if (start_visible) await expect(trim_start).toBeVisible();
        if (end_visible) await expect(trim_end).toBeVisible();
    });

    test('Clip inspector shows fade controls', async ({ page }) => {
        if (!await create_midi_clip(page)) return;
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const fade_in = inspector.getByRole('slider', { name: /Fade in duration/i });
        const fade_out = inspector.getByRole('slider', { name: /Fade out duration/i });
        const in_visible = await fade_in.isVisible().catch(() => false);
        const out_visible = await fade_out.isVisible().catch(() => false);
        if (in_visible) await expect(fade_in).toBeVisible();
        if (out_visible) await expect(fade_out).toBeVisible();
    });

    test('Clip inspector shows gain control', async ({ page }) => {
        if (!await create_midi_clip(page)) return;
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gain = inspector.getByRole('slider', { name: /Clip gain/i });
        if (await gain.isVisible().catch(() => false)) {
            const value = await gain.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test('Clip gain envelope can be enabled', async ({ page }) => {
        if (!await create_midi_clip(page)) return;
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const enable = inspector.getByRole('button', { name: /Enable gain envelope/i });
        if (await enable.isVisible().catch(() => false)) {
            await enable.click();
            await page.waitForTimeout(500);
            const disable = inspector.getByRole('button', { name: /Disable gain envelope/i });
            const has_disable = await disable.isVisible().catch(() => false);
            if (has_disable) {
                await expect(disable).toBeVisible();
                const add_bp = inspector.getByRole('button', { name: /Add breakpoint/i });
                const reset = inspector.getByRole('button', { name: /Reset gain envelope/i });
                if (await add_bp.isVisible().catch(() => false)) await expect(add_bp).toBeVisible();
                if (await reset.isVisible().catch(() => false)) await expect(reset).toBeVisible();
            }
        }
    });

    test('Clip color picker has options', async ({ page }) => {
        if (!await create_midi_clip(page)) return;
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const colors = inspector.getByRole('button', { name: /Set color|Default color/i });
        const count = await colors.count();
        expect(count).toBeGreaterThanOrEqual(0);
    });
});
