import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPreferences(page: import('@playwright/test').Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
}

// Each section's first FieldGroup label — unique per section, so its presence
// proves the content swapped after the nav click.
const SECTION_MARKER: Record<string, RegExp> = {
    General: /Track Height/i,
    Appearance: /Theme/i,
    Layout: /Panel Placement/i,
    Audio: /Audio Devices/i,
    MIDI: /MIDI Input/i,
    Performance: /Audio Processing Profile/i,
    AI: /AI execution backend/i,
};

async function navTo(page: import('@playwright/test').Page, label: string): Promise<void> {
    // The section nav buttons live in the dialog sidebar.
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
}

test.describe('Preferences dialog — section navigation deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPreferences(page);
    });

    test('each nav section swaps the body content', async ({ page }) => {
        for (const [label, marker] of Object.entries(SECTION_MARKER)) {
            await navTo(page, label);
            // The section's distinctive FieldGroup label renders — proving the
            // content swapped, not just that a button was clicked.
            await expect(page.getByRole('dialog').getByText(marker).first()).toBeVisible();
        }
    });

    test('General → Auto Save toggle flips aria-checked', async ({ page }) => {
        await navTo(page, 'General');
        const autoSave = page.getByRole('switch', { name: /Auto Save/i });
        await autoSave.waitFor({ state: 'visible' });
        const before = await autoSave.getAttribute('aria-checked');
        await autoSave.click();
        await expect(autoSave).not.toHaveAttribute('aria-checked', before ?? '');
        // Toggle back so the assertion is symmetric and unambiguous.
        await autoSave.click();
        await expect(autoSave).toHaveAttribute('aria-checked', before ?? '');
    });

    test('Shortcuts section lists captured bindings', async ({ page }) => {
        await navTo(page, 'Shortcuts');
        // The section renders its title and a "Reset to Defaults" action, plus
        // category headers — proving the shortcut grid mounted, not just the nav.
        await expect(page.getByRole('dialog').getByText('Keyboard Shortcuts')).toBeVisible();
        await expect(page.getByRole('dialog').getByRole('button', { name: /Reset to Defaults/i })).toBeVisible();
        // CaptureKeyButton holds each binding; several must be present.
        const bindings = page.getByRole('dialog').getByRole('button', { name: /\+|Ctrl|Cmd|Shift|Alt|Space/ });
        expect(await bindings.count()).toBeGreaterThan(2);
    });

    test('Reset Defaults restores Auto Save without crashing', async ({ page }) => {
        await navTo(page, 'General');
        const autoSave = page.getByRole('switch', { name: /Auto Save/i });
        const initial = await autoSave.getAttribute('aria-checked');
        await autoSave.click();
        await expect(autoSave).not.toHaveAttribute('aria-checked', initial ?? '');

        await page.getByRole('dialog').getByRole('button', { name: /Reset Defaults/i }).click();
        await page.waitForTimeout(300);
        // After reset the toggle returns to its default-checked state.
        await expect(autoSave).toHaveAttribute('aria-checked', initial ?? '');
    });

    test('Done button closes the dialog', async ({ page }) => {
        await page.getByRole('dialog').getByRole('button', { name: /^Done$/ }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
});
