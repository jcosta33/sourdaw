import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Dirty Indicator', () => {
    test('Dirty indicator appears after adding track and clears on save', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0);

        await add_track(page, 'MIDI');
        await expect(page.locator('[title="Unsaved changes"]')).toBeVisible({ timeout: 10000 });

        await page.keyboard.press(`${MOD}+s`);
        await expect(page.locator('[title="Unsaved changes"]')).toBeHidden({ timeout: 10000 });
    });
});

test.describe('N Key Adds MIDI Track', () => {
    test('Pressing N creates a MIDI track in the track list', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const before = await track_list.getByRole('row', { name: /MIDI/i }).count();

        await page.keyboard.press('n');
        await page.waitForTimeout(1000);

        const after = await track_list.getByRole('row', { name: /MIDI/i }).count();
        expect(after).toBeGreaterThan(before);
    });
});

test.describe('Shift+N Adds Audio Track', () => {
    test('Pressing Shift+N creates an Audio track', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const before = await track_list.getByRole('row', { name: /Audio/i }).count();

        await page.keyboard.press('Shift+N');
        await page.waitForTimeout(1000);

        const after = await track_list.getByRole('row', { name: /Audio/i }).count();
        expect(after).toBeGreaterThan(before);
    });
});

test.describe('Cmd+B Toggles Browser', () => {
    test('Cmd+B hides then shows browser panel', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const was_visible = await browser.isVisible().catch(() => false);

        await page.keyboard.press(`${MOD}+b`);
        await page.waitForTimeout(300);
        const now_visible = await browser.isVisible().catch(() => false);
        expect(now_visible).not.toBe(was_visible);
    });
});

test.describe('M Key Toggles Metronome', () => {
    test('M key flips metronome state', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('m');
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('m');
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('L Key Toggles Loop', () => {
    test('L key activates loop mode', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        const loop = page.getByRole('button', { name: 'Loop', exact: true });
        await expect(loop).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('l');
        await expect(loop).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('Cmd+K Opens Command Palette', () => {
    test('Cmd+K shows palette input', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press(`${MOD}+k`);
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(input).toBeHidden({ timeout: 3000 });
    });
});

test.describe('Cmd+Shift+K Toggles Virtual Keyboard', () => {
    test('Cmd+Shift+K shows then hides virtual keyboard', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(page.getByRole('application', { name: /Virtual Piano Keyboard/i })).toBeVisible({ timeout: 5000 });

        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(page.getByRole('application', { name: /Virtual Piano Keyboard/i })).toBeHidden();
    });
});

test.describe('Cmd+J Toggles AI Chat', () => {
    test('Cmd+J shows then hides AI chat panel', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press(`${MOD}+j`);
        await expect(page.getByText(/The kitchen is quiet/i)).toBeVisible({ timeout: 5000 });

        await page.keyboard.press(`${MOD}+j`);
        await expect(page.getByText(/The kitchen is quiet/i)).toBeHidden();
    });
});

test.describe('Cmd+I Toggles Inspector', () => {
    test('Cmd+I hides then shows inspector', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const was_visible = await inspector.isVisible().catch(() => false);

        await page.keyboard.press(`${MOD}+i`);
        await page.waitForTimeout(300);
        const now_visible = await inspector.isVisible().catch(() => false);
        expect(now_visible).not.toBe(was_visible);
    });
});

test.describe('Cmd+M Toggles Bottom Dock', () => {
    test('Cmd+M opens then closes bottom dock', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press(`${MOD}+m`);
        await expect(page.locator('#bottom-dock-tabpanel')).toBeVisible({ timeout: 5000 });

        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(page.locator('#bottom-dock-tabpanel')).toBeHidden();
    });
});
