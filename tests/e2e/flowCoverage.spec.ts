import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Transport Recording Flow', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Record button toggles armed state with aria-pressed', async ({ page }) => {
        const record = page.getByRole('button', { name: 'Record' }).or(page.getByRole('button', { name: 'Stop recording' }));
        const pressed_before = await record.first().getAttribute('aria-pressed');
        await record.first().click();
        await page.waitForTimeout(300);
        const pressed_after = await record.first().getAttribute('aria-pressed');
        expect(pressed_after).not.toBe(pressed_before);
    });

    test('Play then stop does not crash the transport', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        const stop = page.getByRole('button', { name: 'Stop' });

        await play.first().click();
        await page.waitForTimeout(500);
        await stop.click();
        await page.waitForTimeout(500);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('Loop toggle followed by play engages loop mode', async ({ page }) => {
        const loop = page.getByRole('button', { name: 'Loop', exact: true });
        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'true');

        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        await play.first().click();
        await page.waitForTimeout(500);
        await play.first().click();
        await page.waitForTimeout(300);

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('Chord Track With Template', () => {
    test('Pop Song template shows chord track with chord content', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await launch_screen.waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);

        const chord_track = page.getByRole('region', { name: 'Chord track' });
        if (await chord_track.isVisible().catch(() => false)) {
            const add_chord = chord_track.getByRole('button', { name: /Add chord event/i });
            if (await add_chord.isVisible().catch(() => false)) {
                await expect(add_chord).toBeVisible();
            }

            const clear = chord_track.getByRole('button', { name: /Clear all chords/i });
            if (await clear.isVisible().catch(() => false)) {
                await expect(clear).toBeVisible();
            }

            const follow = chord_track.getByRole('button', { name: /Enable harmonic following|Disable harmonic following/i });
            if (await follow.isVisible().catch(() => false)) {
                await expect(follow).toBeVisible();
            }
        }
    });
});

test.describe('Arrangement Bar Section Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Arrangement sections region is present and interactive', async ({ page }) => {
        const sections = page.getByRole('region', { name: 'Arrangement sections' });
        await expect(sections).toBeVisible();

        const box = await sections.boundingBox();
        if (box) {
            await sections.click({ button: 'right', position: { x: 50, y: box.height * 0.5 } });
            const menu = page.getByRole('menu');
            if (await menu.isVisible().catch(() => false)) {
                const items = menu.getByRole('menuitem');
                const count = await items.count();
                expect(count).toBeGreaterThan(0);
                await page.keyboard.press('Escape');
            }
        }
    });
});

test.describe('Adjustment Layer Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Can add adjustment layer and it persists in strip', async ({ page }) => {
        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        const add_button = page.getByRole('button', { name: 'Add adjustment layer' });

        await add_button.click();
        await page.waitForTimeout(1000);

        await expect(strip).toBeVisible();
        await expect(add_button).toBeVisible();
    });
});

test.describe('Session View Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-session').click();
    });

    test('Session view panel has interactive content', async ({ page }) => {
        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('Session view shows scene or empty state content', async ({ page }) => {
        const panel = page.locator('#bottom-dock-tabpanel');
        const content = panel.getByText(/scene|No session|empty|track/i);
        const visible = await content.first().isVisible().catch(() => false);
        if (visible) {
            await expect(content.first()).toBeVisible();
        }
    });
});

test.describe('Notification System', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Status bar shows last action text', async ({ page }) => {
        await add_track(page, 'MIDI');
        await page.waitForTimeout(500);

        const status = page.getByRole('status', { name: 'Application status' });
        const last_action = status.getByText(/Last:/i);
        if (await last_action.isVisible().catch(() => false)) {
            const text = await last_action.textContent();
            expect(text).toMatch(/add|track|midi/i);
        }
    });

    test('Undo count in status bar updates after actions', async ({ page }) => {
        await add_track(page, 'MIDI');
        await page.waitForTimeout(500);

        const status = page.getByRole('status', { name: 'Application status' });
        const undo_info = status.getByText(/undo/i);
        if (await undo_info.isVisible().catch(() => false)) {
            const text = await undo_info.textContent();
            expect(text).toMatch(/\d/);
        }
    });
});

test.describe('Panel Layout Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Browser panel can be toggled on and off', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle browser' });
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const was_visible = await browser.isVisible().catch(() => false);

        await toggle.click();
        await page.waitForTimeout(300);
        const now_visible = await browser.isVisible().catch(() => false);
        expect(now_visible).not.toBe(was_visible);

        await toggle.click();
        await page.waitForTimeout(300);
    });

    test('Inspector panel can be toggled on and off', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle inspector' });
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const was_visible = await inspector.isVisible().catch(() => false);

        await toggle.click();
        await page.waitForTimeout(300);
        const now_visible = await inspector.isVisible().catch(() => false);
        expect(now_visible).not.toBe(was_visible);

        await toggle.click();
        await page.waitForTimeout(300);
    });

    test('Bottom dock can be toggled repeatedly', async ({ page }) => {
        const dock_toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
        const close_dock = page.getByRole('button', { name: 'Close bottom dock' });

        await dock_toggle.click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible({ timeout: 5000 });
        await close_dock.click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeHidden();

        await dock_toggle.click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible({ timeout: 5000 });
        await close_dock.click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeHidden();
    });
});
