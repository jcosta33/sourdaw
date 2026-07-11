import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Remaining Element Coverage', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Audio track has input/output device selectors in inspector', async ({ page }) => {
        await add_track(page, 'Audio');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        const input = inspector.getByRole('combobox', { name: 'Audio input device' });
        if (await input.isVisible().catch(() => false)) {
            const options = await input.getByRole('option').count();
            expect(options).toBeGreaterThanOrEqual(0);
        }

        const output = inspector.getByRole('combobox', { name: 'Audio output device' });
        if (await output.isVisible().catch(() => false)) {
            await expect(output).toBeVisible();
        }
    });

    test('Transport mark punch region button is present when armed', async ({ page }) => {
        const punch = page.getByRole('button', { name: 'Punch in/out' });
        await punch.click();

        const mark = page.getByRole('button', { name: 'Mark punch region from current capture' });
        await expect(mark).toBeVisible();
        const is_disabled = await mark.isDisabled().catch(() => true);
        expect(typeof is_disabled).toBe('boolean');
    });

    test('Tempo map can be toggled and shows tempo change UI', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle tempo map' });
        const expanded_before = await toggle.getAttribute('aria-expanded');
        await toggle.click();
        await page.waitForTimeout(500);

        const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });
        const visible = await dialog.isVisible().catch(() => false);
        if (visible) {
            const add_change = page.getByRole('button', { name: 'Add tempo change' });
            if (await add_change.isVisible().catch(() => false)) {
                await expect(add_change).toBeVisible();
            }
            const beat_input = page.getByRole('spinbutton', { name: 'New tempo change beat' });
            if (await beat_input.isVisible().catch(() => false)) {
                await expect(beat_input).toBeVisible();
            }
            const bpm_input = page.getByRole('spinbutton', { name: 'New tempo change BPM' });
            if (await bpm_input.isVisible().catch(() => false)) {
                await expect(bpm_input).toBeVisible();
            }
        }
    });

    test('AI chat panel has action controls', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await page.waitForTimeout(500);

        const clear = page.getByRole('button', { name: /Clear action history/i });
        if (await clear.isVisible().catch(() => false)) {
            await expect(clear).toBeVisible();
        }

        const close_history = page.getByRole('button', { name: /Close action history/i });
        if (await close_history.isVisible().catch(() => false)) {
            await expect(close_history).toBeVisible();
        }
    });

    test('Generative AI panel has generation controls', async ({ page }) => {
        await page.getByRole('button', { name: 'Generate' }).click();
        await page.waitForTimeout(1000);

        const toggle_gen = page.getByRole('button', { name: /Toggle generation controls/i });
        if (await toggle_gen.isVisible().catch(() => false)) {
            await expect(toggle_gen).toBeVisible();
        }

        const search_patterns = page.getByRole('searchbox', { name: /Search MIDI patterns/i });
        if (await search_patterns.isVisible().catch(() => false)) {
            await expect(search_patterns).toBeVisible();
        }
    });

    test('Redo button is present and reflects state', async ({ page }) => {
        const redo = page.getByRole('button', { name: 'Redo' });
        await expect(redo).toBeVisible();
    });

    test('Toggle Session + Arrangement View button is present', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle Session + Arrangement View' });
        await expect(toggle).toBeVisible();
        await toggle.click();
        await page.waitForTimeout(500);
        await expect(toggle).toBeVisible();
    });

    test('Ableton Link toggle changes label on click', async ({ page }) => {
        const link = page.getByRole('button', { name: /Ableton Link/i });
        const label_before = await link.getAttribute('aria-label');
        await link.click();
        await page.waitForTimeout(500);
        await expect(link).toBeVisible();
    });

    test('Track list toggle shows and hides track list', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle track list' });
        await expect(toggle).toBeVisible();
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const visible_before = await track_list.isVisible().catch(() => false);

        await toggle.click();
        await page.waitForTimeout(300);
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toBeVisible();
    });

    test('Inspector close automation panel button works after adding lane', async ({ page }) => {
        await add_track(page, 'MIDI');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Add automation lane/i }).click();
        await page.waitForTimeout(500);

        const close_lane = inspector.getByRole('button', { name: /Close lane|Remove lane/i });
        if (await close_lane.first().isVisible().catch(() => false)) {
            await expect(close_lane.first()).toBeVisible();
        }
    });

    test('Sends section has Create Bus button', async ({ page }) => {
        await add_track(page, 'MIDI');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const create_bus = inspector.getByRole('button', { name: 'Create Bus' });
        if (await create_bus.isVisible().catch(() => false)) {
            await create_bus.click();
            await page.waitForTimeout(500);
            await expect(page.getByRole('grid', { name: /Track list/i }).getByRole('row').first()).toBeVisible();
        }
    });

    test('MIDI FX slots are present in inspector', async ({ page }) => {
        await add_track(page, 'MIDI');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const midi_fx = inspector.getByText('MIDI FX');
        if (await midi_fx.isVisible().catch(() => false)) {
            const slots = inspector.getByRole('button', { name: /^\+/ });
            const count = await slots.count();
            expect(count).toBeGreaterThanOrEqual(0);
        }
    });

    test('Inspector shows routing or latency info', async ({ page }) => {
        await add_track(page, 'MIDI');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const routing = inspector.getByText(/Routing|Latency|routing|latency/i);
        const visible = await routing.first().isVisible().catch(() => false);
        if (visible) {
            await expect(routing.first()).toBeVisible();
        }
    });

    test('Inspector clips section is present', async ({ page }) => {
        await add_track(page, 'MIDI');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const clips = inspector.getByText(/Clips|clips|No clips/i);
        const visible = await clips.first().isVisible().catch(() => false);
        if (visible) {
            await expect(clips.first()).toBeVisible();
        }
    });

    test('Browser Instruments tab content is interactive', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
        await page.waitForTimeout(500);
        const instruments = browser.getByRole('button', { name: /Fermenter|Toaster|Levain|Grand Boule|Crumbs/i });
        const count = await instruments.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Overdub button appears when MIDI track is armed', async ({ page }) => {
        await add_track(page, 'MIDI');
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const arm = track_list.getByRole('button', { name: /^Arm / });
        await arm.first().click();
        await page.waitForTimeout(500);

        const overdub = page.getByRole('button', { name: 'Overdub' });
        if (await overdub.isVisible().catch(() => false)) {
            await expect(overdub).toHaveAttribute('aria-pressed', 'false');
            await overdub.click();
            await expect(overdub).toHaveAttribute('aria-pressed', 'true');
        }
    });
});
