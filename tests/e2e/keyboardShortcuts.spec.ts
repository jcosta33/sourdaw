import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Keyboard Shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();
    });

    test('Can add a MIDI track with N key', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list.getByRole('row', { name: /MIDI/i })).toHaveCount(0);

        await page.keyboard.press('n');

        await expect(track_list.getByRole('row', { name: /MIDI/i }).first()).toBeVisible({ timeout: 5000 });
    });

    test('Can toggle the browser/sidebar with Cmd+B', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await expect(browser).toBeVisible();

        await page.keyboard.press(`${MOD}+b`);

        await expect(browser).toBeHidden();
        await page.keyboard.press(`${MOD}+b`);
        await expect(browser).toBeVisible();
    });

    test('Can toggle the inspector with Cmd+I', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();

        await page.keyboard.press(`${MOD}+i`);

        await expect(inspector).toBeHidden();
        await page.keyboard.press(`${MOD}+i`);
        await expect(inspector).toBeVisible();
    });

    test('Can toggle the bottom dock with Cmd+M', async ({ page }) => {
        await page.keyboard.press(`${MOD}+m`);
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });

        await page.keyboard.press(`${MOD}+m`);
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeHidden();
    });

    test('Can toggle the virtual keyboard with Cmd+Shift+K', async ({ page }) => {
        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(page.getByRole('application', { name: /Virtual Piano Keyboard/i })).toBeVisible({ timeout: 5000 });

        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(page.getByRole('application', { name: /Virtual Piano Keyboard/i })).toBeHidden();
    });

    test('Can open the shortcut cheat sheet with ?', async ({ page }) => {
        await page.keyboard.press('Shift+Slash');
        await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toBeHidden();
    });

    test('Can open preferences dialog', async ({ page }) => {
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        await expect(page.getByRole('dialog').filter({ hasText: /Preferences/i })).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });

    test('Can open the command palette with Cmd+K', async ({ page }) => {
        await page.keyboard.press(`${MOD}+k`);
        await expect(page.getByPlaceholder('Type a command...', { exact: true })).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });

    test('Can toggle the AI chat panel with Cmd+J', async ({ page }) => {
        await page.keyboard.press(`${MOD}+j`);
        await expect(page.getByText(/The kitchen is quiet/i)).toBeVisible({ timeout: 5000 });

        await page.keyboard.press(`${MOD}+j`);
        await expect(page.getByText(/The kitchen is quiet/i)).toBeHidden();
    });

    test('Metronome toggles with M key', async ({ page }) => {
        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('m');
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('m');
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('Loop toggles with L key', async ({ page }) => {
        const loop = page.getByRole('button', { name: 'Loop', exact: true });
        await expect(loop).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('l');
        await expect(loop).toHaveAttribute('aria-pressed', 'true');
    });
});
