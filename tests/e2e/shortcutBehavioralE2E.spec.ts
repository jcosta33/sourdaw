import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

test.beforeEach(async ({ page }) => {
    test.setTimeout(120000);
    await setupWorkspace(page);
    await launch_new_project(page);
    await focusWorkspace(page);
});

test.describe('Dirty indicator', () => {
    test('appears after adding a MIDI track and clears on save', async ({ page }) => {
        const dirty = page.getByTitle('Unsaved changes');
        await expect(dirty).toHaveCount(0);

        await page.keyboard.press('n');
        await expect(trackList(page).getByText('MIDI', { exact: true })).toBeVisible();
        await expect(dirty).toBeVisible();

        await page.keyboard.press(`${MOD}+s`);
        await expect(dirty).toHaveCount(0);
    });
});

test.describe('Track creation shortcuts', () => {
    test('N creates a MIDI track', async ({ page }) => {
        await expect(page.getByText('Add your first track')).toBeVisible();

        await page.keyboard.press('n');
        await expect(trackList(page).getByText('MIDI', { exact: true })).toBeVisible();
        await expect(page.getByText('Add your first track')).toHaveCount(0);
    });

    test('Shift+N creates an Audio track', async ({ page }) => {
        await expect(page.getByText('Add your first track')).toBeVisible();

        await page.keyboard.press('Shift+N');
        await expect(trackList(page).getByText('Audio', { exact: true })).toBeVisible();
        await expect(page.getByText('Add your first track')).toHaveCount(0);
    });
});

test.describe('Panel shortcuts', () => {
    test('Cmd+B hides then shows the browser', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle browser' });
        const panel = page.getByRole('complementary', { name: 'Browser panel' });

        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(panel).toBeVisible();

        await page.keyboard.press(`${MOD}+b`);
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(panel).toBeHidden();

        await page.keyboard.press(`${MOD}+b`);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(panel).toBeVisible();
    });

    test('Cmd+I hides then shows the inspector', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle inspector' });
        const panel = page.getByRole('complementary', { name: 'Inspector panel' });

        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(panel).toBeVisible();

        await page.keyboard.press(`${MOD}+i`);
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(panel).toBeHidden();

        await page.keyboard.press(`${MOD}+i`);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(panel).toBeVisible();
    });

    test('Cmd+M opens then closes the bottom dock', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
        const tabs = page.getByRole('tablist', { name: 'Bottom dock' });

        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(tabs).toHaveCount(0);

        await page.keyboard.press(`${MOD}+m`);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(tabs).toBeVisible();

        await page.keyboard.press(`${MOD}+m`);
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(tabs).toHaveCount(0);
    });

    test('Cmd+J shows then hides AI chat', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle AI chat panel' });
        const empty = page.getByText('The kitchen is quiet', { exact: true });

        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(empty).toHaveCount(0);

        await page.keyboard.press(`${MOD}+j`);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(empty).toBeVisible();

        await page.keyboard.press(`${MOD}+j`);
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(empty).toHaveCount(0);
    });

    test('Cmd+Shift+K shows then hides the virtual keyboard', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle virtual keyboard' });
        const keyboard = page.getByRole('application', { name: /Virtual Piano Keyboard/i });

        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(keyboard).toHaveCount(0);

        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(keyboard).toBeVisible();

        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(keyboard).toHaveCount(0);
    });
});

test.describe('Transport shortcuts', () => {
    test('M key toggles metronome', async ({ page }) => {
        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('m');
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('m');
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('L key toggles loop', async ({ page }) => {
        const loop = page.getByRole('button', { name: 'Loop', exact: true });
        await expect(loop).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('l');
        await expect(loop).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('l');
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('Command palette', () => {
    test('Cmd+K shows then dismisses the palette', async ({ page }) => {
        const input = page.getByPlaceholder('Type a command...', { exact: true });
        await expect(input).toHaveCount(0);

        await page.keyboard.press(`${MOD}+k`);
        await expect(input).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(input).toHaveCount(0);
    });
});
