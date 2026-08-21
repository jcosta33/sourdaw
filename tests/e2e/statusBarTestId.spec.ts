import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
}

test.describe('Status bar', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('undo history opens empty and the status-bar toggle dismisses it', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle undo history panel', exact: true });
        const close = page.getByRole('button', { name: 'Close undo history', exact: true });

        await expect(toggle).toContainText('0 undos');
        await expect(close).toHaveCount(0);

        await toggle.click();
        await expect(close).toBeVisible();
        await expect(page.getByText('No history yet', { exact: true })).toBeVisible();

        await toggle.click();
        await expect(close).toHaveCount(0);
        await expect(page.getByText('No history yet', { exact: true })).toHaveCount(0);
    });

    test('adding a MIDI track shows Last action and lists it in undo history', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        const toggle = page.getByRole('button', { name: 'Toggle undo history panel', exact: true });

        await expect(toggle).toContainText('0 undos');
        await expect(status.getByText(/^Last: /)).toHaveCount(0);

        await addMidiTrack(page);

        await expect(toggle).toContainText('1 undo');
        await expect(status.getByText(/^Last: /)).toBeVisible();

        await toggle.click();
        await expect(page.getByRole('button', { name: 'Close undo history', exact: true })).toBeVisible();
        await expect(page.getByText('No history yet', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Current State', { exact: true })).toBeVisible();
    });

    test('collaboration panel opens from the status bar and the toggle dismisses it', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle collaboration panel', exact: true });
        const panel = page.getByRole('dialog', { name: 'Collaborate', exact: true });

        await expect(panel).toHaveCount(0);
        await toggle.click();
        await expect(panel).toBeVisible();

        await toggle.click();
        await expect(panel).toHaveCount(0);
    });
});
