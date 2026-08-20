import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Automation lanes — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
        await openBottomTab(page, 'Automation');
    });

    test('automation mode button is present via test ID', async ({ page }) => {
        const mode = page.getByRole('button', { name: /Automation mode/ });
        await expect(mode).toBeVisible();
        await expect(mode).toHaveAttribute('data-testid', 'automation-mode-button');
    });

    test('automation mode shows the current mode label', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        await expect(mode).toBeVisible();
        await expect(mode).toHaveText('R');
    });

    test('clicking automation mode opens a dropdown', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        await expect(mode).toBeVisible();
        await mode.click();

        for (const name of ['Read', 'Write', 'Touch', 'Latch'] as const) {
            await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        }

        await page.keyboard.press('Escape');
    });

    test('automation mode has a valid aria-label', async ({ page }) => {
        const mode = page.getByRole('button', { name: /Automation mode/ });
        await expect(mode).toBeVisible();
        await expect(mode).toHaveAttribute('aria-label', /Automation mode/);
    });
});
