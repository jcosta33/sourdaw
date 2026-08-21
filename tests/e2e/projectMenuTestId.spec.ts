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

test.describe('Project menu', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Project menu lists New Project, Save, and Export Audio', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Project menu', exact: true });
        const menu = page.getByRole('menu', { name: 'Project menu', exact: true });

        await expect(menu).toHaveCount(0);
        await toggle.click();
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'New Project', exact: true })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: /^Save/ })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: /^Export Audio/ })).toBeVisible();
    });

    test('New Project clears an added MIDI track from the arrangement', async ({ page }) => {
        await addMidiTrack(page);
        const trackList = page.getByRole('grid', { name: /Track list/i });
        await expect(trackList.first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Toggle undo history panel', exact: true })).toHaveText('1 undo');

        await page.getByRole('button', { name: 'Project menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();

        await expect(trackList).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Toggle undo history panel', exact: true })).toHaveText(
            '0 undos'
        );
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Export Audio opens The Bakery and Cancel closes it', async ({ page }) => {
        await page.getByRole('button', { name: 'Project menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Export Audio/ }).click();

        const bakery = page.getByRole('dialog').filter({ hasText: 'The Bakery' });
        await expect(bakery).toBeVisible();
        await bakery.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(bakery).toHaveCount(0);
    });
});
