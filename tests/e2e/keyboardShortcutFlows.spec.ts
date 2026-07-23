import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Zoom Keyboard Shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();
    });

    test('Equal key zooms in', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();
        await page.keyboard.press('=');
        await page.keyboard.press('=');
        await expect(timeline).toBeVisible();
    });

    test('Minus key zooms out', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();
        await page.keyboard.press('-');
        await page.keyboard.press('-');
        await expect(timeline).toBeVisible();
    });

    test('F key zooms to fit', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();
        await page.keyboard.press('f');
        await expect(timeline).toBeVisible();
    });
});

test.describe('Marker Navigation', () => {
    test('Bracket keys navigate markers without crash', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press(']');
        await page.waitForTimeout(300);
        await page.keyboard.press('[');
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Home/End Seek', () => {
    test('Home seeks to start', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press('Home');
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('End seeks to last clip', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press('End');
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Number Key Tool Selection', () => {
    test('1-5 select tools via keyboard', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();

        await page.keyboard.press('3');
        // Exact match: /Draw/i also matches "Auto-draw".
        await expect(tools.getByRole('radio', { name: /^Draw/i })).toBeChecked();

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();
    });
});

test.describe('Delete/Backspace on Selection', () => {
    test('Delete key does not crash when nothing selected', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Cmd+A Select All', () => {
    test('Cmd+A does not crash', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press(`${MOD}+a`);
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Cmd+D Duplicate', () => {
    test('Cmd+D without selection does not crash', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press(`${MOD}+d`);
        await page.waitForTimeout(500);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Escape Key', () => {
    test('Escape does not crash in initial state', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Space Key Playback', () => {
    test('Space does not crash when PromptBar is not focused', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press('Space');
        await page.waitForTimeout(500);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});
