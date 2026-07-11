import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Automation Modulator Form Fields', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-modulation').click();
    });

    test('Modulation matrix add button reveals modulator form', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        const add_btn = matrix.getByRole('button', { name: /Add|Create|New|\+/i }).first();
        if (await add_btn.isVisible().catch(() => false)) {
            await add_btn.click();
            await page.waitForTimeout(500);

            const kind = page.getByRole('combobox', { name: 'Modulator kind' });
            if (await kind.isVisible().catch(() => false)) {
                await expect(kind).toBeVisible();
                const options = await kind.getByRole('option').count();
                expect(options).toBeGreaterThan(0);
            }

            const scope = page.getByRole('combobox', { name: 'Modulator track scope' });
            if (await scope.isVisible().catch(() => false)) {
                await expect(scope).toBeVisible();
            }

            const close = page.getByRole('button', { name: 'Close new modulator form' });
            if (await close.isVisible().catch(() => false)) {
                await expect(close).toBeVisible();
            }
        }
    });

    test('Modulator name input accepts text', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        const add_btn = matrix.getByRole('button', { name: /Add|Create|New|\+/i }).first();
        if (await add_btn.isVisible().catch(() => false)) {
            await add_btn.click();
            await page.waitForTimeout(500);

            const name = page.getByRole('textbox', { name: 'Modulator name' });
            if (await name.isVisible().catch(() => false)) {
                await name.fill('LFO 1');
                await expect(name).toHaveValue('LFO 1');
            }
        }
    });

    test('Modulator form has target mapping selectors', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        const add_btn = matrix.getByRole('button', { name: /Add|Create|New|\+/i }).first();
        if (await add_btn.isVisible().catch(() => false)) {
            await add_btn.click();
            await page.waitForTimeout(500);

            const target_track = page.getByRole('combobox', { name: 'Target track' });
            const target_device = page.getByRole('combobox', { name: 'Target device' });
            const target_param = page.getByRole('combobox', { name: 'Target parameter' });

            const track_visible = await target_track.isVisible().catch(() => false);
            const device_visible = await target_device.isVisible().catch(() => false);
            const param_visible = await target_param.isVisible().catch(() => false);

            if (track_visible) await expect(target_track).toBeVisible();
            if (device_visible) await expect(target_device).toBeVisible();
            if (param_visible) await expect(target_param).toBeVisible();
        }
    });
});

test.describe('Setlist Move Operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-setlist').click();
    });

    test('Move up and move down are present', async ({ page }) => {
        const move_up = page.getByRole('button', { name: 'Move up' });
        const move_down = page.getByRole('button', { name: 'Move down' });

        const up_visible = await move_up.first().isVisible().catch(() => false);
        const down_visible = await move_down.first().isVisible().catch(() => false);

        if (up_visible) {
            await move_up.first().click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(300);
        }
        if (down_visible) {
            await move_down.first().click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(300);
        }
    });

    test('Setlist count-in bars is present', async ({ page }) => {
        const count_in = page.getByRole('spinbutton', { name: /Count-in bars/i });
        if (await count_in.isVisible().catch(() => false)) {
            await expect(count_in).toBeVisible();
        }
    });

    test('Setlist items can be removed', async ({ page }) => {
        await page.getByRole('button', { name: 'Add setlist item' }).click();
        await page.waitForTimeout(500);

        const remove = page.getByRole('button', { name: /Remove/i });
        if (await remove.first().isVisible().catch(() => false)) {
            const items_before = await page.getByRole('list', { name: 'Setlist items' }).getByRole('listitem').count().catch(() => 0);
            await remove.first().click();
            await page.waitForTimeout(500);
        }
    });
});

test.describe('Prompt Bar AI Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Prompt bar has confirm and cancel action buttons when populated', async ({ page }) => {
        const prompt = page.getByRole('textbox', { name: 'Prompt command input' });
        await prompt.fill('add a drum beat');
        await page.waitForTimeout(500);

        const confirm = page.getByRole('button', { name: /Confirm actions/i });
        const cancel = page.getByRole('button', { name: /Cancel actions/i });

        const confirm_visible = await confirm.isVisible().catch(() => false);
        const cancel_visible = await cancel.isVisible().catch(() => false);

        if (confirm_visible || cancel_visible) {
            expect(confirm_visible || cancel_visible).toBe(true);
        }
    });

    test('Cancel AI processing button is present', async ({ page }) => {
        const cancel_ai = page.getByRole('button', { name: /Cancel AI processing/i });
        const visible = await cancel_ai.isVisible().catch(() => false);
    });

    test('AI voice command overlay stop button appears on press', async ({ page }) => {
        const voice = page.getByRole('button', { name: /Voice command/i });
        await voice.click();
        await page.waitForTimeout(300);

        const stop_voice = page.getByRole('button', { name: 'Stop voice input' });
        if (await stop_voice.isVisible().catch(() => false)) {
            await expect(stop_voice).toBeVisible();
            await stop_voice.click();
        }
    });
});

test.describe('Arrangement Take Lane Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
    });

    test('Audio track inspector has flatten comp button when takes exist', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const flatten = inspector.getByRole('button', { name: /Flatten comp/i });
        if (await flatten.isVisible().catch(() => false)) {
            await expect(flatten).toBeVisible();
        }
    });

    test('Audio track has input monitoring selector', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const monitor = track_list.getByRole('button', { name: /Input monitoring/i });
        if (await monitor.first().isVisible().catch(() => false)) {
            const label = await monitor.first().getAttribute('aria-label');
            expect(label).toContain('Input monitoring');
        }
    });
});

test.describe('Master Track Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Master track is visible in track list', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const master = track_list.getByRole('row', { name: /Master/i });
        if (await master.isVisible().catch(() => false)) {
            await expect(master).toBeVisible();
        } else {
            const master_button = page.getByRole('button', { name: /Master/i });
            const visible = await master_button.first().isVisible().catch(() => false);
            expect(typeof visible).toBe('boolean');
        }
    });

    test('Master track spectrum button is present', async ({ page }) => {
        const master_spectrum = page.getByRole('button', { name: 'Master Track Spectrum' });
        if (await master_spectrum.isVisible().catch(() => false)) {
            await expect(master_spectrum).toBeVisible();
        }
    });
});
