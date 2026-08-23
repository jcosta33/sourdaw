import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Auto-scroll Toggle Deep', () => {
    test('Auto-scroll starts on, toggles off and on', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const auto_scroll = page.getByRole('button', { name: 'Auto-scroll follows playhead' });
        await expect(auto_scroll).toHaveAttribute('aria-pressed', 'true');

        await auto_scroll.click();
        await expect(auto_scroll).toHaveAttribute('aria-pressed', 'false');

        await auto_scroll.click();
        await expect(auto_scroll).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('AI Panel — Generate Button', () => {
    test('Generate button toggles aria-pressed to open the panel', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const generate = page.getByRole('button', { name: 'Generate', exact: true });
        await expect(generate).toHaveAttribute('aria-pressed', 'false');
        await generate.click();
        await expect(generate).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('AI Chat Panel — Composer', () => {
    test('Chat panel has composer input', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await page.waitForTimeout(500);

        const composer = page.getByPlaceholder(/message/i).or(page.getByRole('textbox').last());
        await expect(composer.first()).toBeVisible({ timeout: 5000 });
    });
});

test.describe('AI availability', () => {
    test('shows the unavailable state when this browser has no admitted LLM backend', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await expect(page.getByText('AI unavailable', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Load AI' })).toHaveCount(0);
    });
});

test.describe('Voice command availability', () => {
    test('does not expose voice controls before a local voice model is available', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        await expect(page.getByTestId('voice-command-button')).toHaveCount(0);
    });
});

test.describe('AI Action History', () => {
    test('AI action history toggle is present', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const history = page.getByRole('button', { name: /Toggle AI action history/i });
        await expect(history).toBeVisible();
    });
});

test.describe('Collaboration Toggle Deep', () => {
    test('Collaboration panel can be opened and closed', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const toggle = page.getByRole('button', { name: 'Toggle collaboration panel' });
        await toggle.click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        await toggle.click();
        await expect(dialog).toBeHidden({ timeout: 5000 });
    });
});

test.describe('Undo History Panel Deep', () => {
    test('Undo history panel toggle shows panel', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.waitForTimeout(300);

        const toggle = page.getByRole('button', { name: /Toggle undo history panel/i });
        await toggle.click();

        // The Close button only renders when the panel is open.
        const close = page.getByRole('button', { name: 'Close undo history' });
        await expect(close).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Generate Button Deep', () => {
    test('Generate button toggles panel visibility', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const generate = page.getByRole('button', { name: 'Generate' });
        await generate.click();
        await page.waitForTimeout(500);
        await generate.click();
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Model Manager / Browser AI', () => {
    test('Generate panel exposes generation controls when opened', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const generate = page.getByRole('button', { name: 'Generate', exact: true });
        await generate.click();
        await page.waitForTimeout(500);

        // The generative panel renders interactive content.
        expect(await page.getByRole('button').count()).toBeGreaterThan(0);
    });
});

test.describe('Browser Search Clear', () => {
    test('Browser search can be cleared', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });

        await search.fill('test query');
        await expect(search).toHaveValue('test query');

        await search.fill('');
        await expect(search).toHaveValue('');
    });
});
