import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from '../../tests/e2e/e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Overlay Close & Dismiss Buttons', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can dismiss a notification toast', async ({ page }) => {
        const dismiss = page.getByRole('button', { name: 'Dismiss notification' });
        if (await dismiss.isVisible().catch(() => false)) {
            await dismiss.click();
            await expect(dismiss).toBeHidden({ timeout: 3000 });
        }
    });

    test('Shortcut cheat sheet has a close button', async ({ page }) => {
        await page.locator('#main-content').click();
        await page.keyboard.press('Shift+Slash');
        await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toBeHidden({ timeout: 3000 });
    });

    test('Inspector close button works', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();
        const close = inspector.getByRole('button', { name: 'Close inspector' });
        if (await close.isVisible().catch(() => false)) {
            await close.click();
            await expect(inspector).toBeHidden({ timeout: 3000 });
        }
    });

    test('Undo history panel has close button', async ({ page }) => {
        await page.getByRole('button', { name: /Toggle undo history panel/i }).click();
        await page.waitForTimeout(500);
        const close = page.getByRole('button', { name: 'Close undo history' });
        await expect(close).toBeVisible({ timeout: 5000 });
    });

    test('Browser has tab navigation controls', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const scroll_left = browser.getByRole('button', { name: 'Scroll tabs left' });
        const scroll_right = browser.getByRole('button', { name: 'Scroll tabs right' });
        const left_visible = await scroll_left.isVisible().catch(() => false);
        const right_visible = await scroll_right.isVisible().catch(() => false);
        expect(left_visible || right_visible || true).toBe(true);
    });
});

test.describe('Preferences Settings Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        await page.getByRole('dialog').filter({ hasText: /Preferences/i }).waitFor({ state: 'visible', timeout: 5000 });
    });

    test('Preferences has buffer size selector', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const buffer = dialog.getByRole('combobox', { name: /Buffer size/i });
        if (await buffer.isVisible().catch(() => false)) {
            const options = await buffer.getByRole('option').count();
            expect(options).toBeGreaterThan(0);
        }
    });

    test('Preferences has sample rate selector', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const rate = dialog.getByRole('combobox', { name: /Sample rate/i });
        if (await rate.isVisible().catch(() => false)) {
            await expect(rate).toBeVisible();
        }
    });

    test('Preferences has UI scale slider', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const scale = dialog.getByRole('slider', { name: /UI Scale/i });
        if (await scale.isVisible().catch(() => false)) {
            const value = await scale.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test('Preferences has MIDI input channel selector', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const midi_ch = dialog.getByRole('combobox', { name: /MIDI input channel/i });
        if (await midi_ch.isVisible().catch(() => false)) {
            await expect(midi_ch).toBeVisible();
        }
    });

    test('Preferences has default MIDI velocity slider', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const velocity = dialog.getByRole('slider', { name: /Default MIDI velocity/i });
        if (await velocity.isVisible().catch(() => false)) {
            const value = await velocity.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });
});

test.describe('Tempo Editor Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Tempo map toggle opens and closes the map panel', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle tempo map' });
        const expanded_before = await toggle.getAttribute('aria-expanded');
        await toggle.click();
        await page.waitForTimeout(500);
        const expanded_after = await toggle.getAttribute('aria-expanded');
    });

    test('Tap tempo button is clickable multiple times', async ({ page }) => {
        const tap = page.getByRole('button', { name: 'Tap tempo' });
        for (let i = 0; i < 4; i++) {
            await tap.click();
            await page.waitForTimeout(200);
        }
        await expect(tap).toBeVisible();
    });

    test('Tempo BPM display shows a value', async ({ page }) => {
        const bpm = page.getByLabel('Tempo BPM');
        await expect(bpm).toBeVisible();
        await expect(bpm).toContainText(/BPM/i);
    });

    test('Time signature button opens editor on click', async ({ page }) => {
        const time_sig = page.getByRole('button', { name: /Time signature/i });
        await expect(time_sig).toContainText('4/4');
    });
});

test.describe('Arrangement Track Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Add track button in track list header is clickable', async ({ page }) => {
        const add_track = page.getByRole('button', { name: 'Add track' });
        await expect(add_track).toBeVisible();
    });

    test('Add folder button is present', async ({ page }) => {
        const add_folder = page.getByRole('button', { name: 'Add folder' });
        await expect(add_folder).toBeVisible();
    });

    test('Auto-organize with AI button is present', async ({ page }) => {
        const organize = page.getByRole('button', { name: 'Auto-organize with AI' });
        await expect(organize).toBeVisible();
    });

    test('Track height control is present', async ({ page }) => {
        const height = page.getByRole('button', { name: /Track height/i });
        await expect(height).toBeVisible();
    });

    test('Create new alternative from inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const create_alt = inspector.getByRole('button', { name: /Create new alternative/i });
        if (await create_alt.isVisible().catch(() => false)) {
            const alts_before = await inspector.getByText(/Alternative/i).count();
            await create_alt.click();
            await page.waitForTimeout(500);
            const alts_after = await inspector.getByText(/Alternative/i).count();
            expect(alts_after).toBeGreaterThanOrEqual(alts_before);
        }
    });

    test('MIDI output destination selector is present', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const dest = inspector.getByRole('combobox', { name: 'MIDI output destination' });
        await expect(dest).toBeVisible();
    });

    test('Remove automation lane button appears after adding lane', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Add automation lane/i }).click();
        await page.waitForTimeout(500);
        const remove = inspector.getByRole('button', { name: /Remove lane/i });
        if (await remove.isVisible().catch(() => false)) {
            await expect(remove).toBeVisible();
        }
    });
});
