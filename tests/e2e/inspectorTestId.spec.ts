import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.locator('#main-content').click();
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
    await trackList.getByRole('row').filter({ hasText: /^MIDI/ }).first().click();
}

test.describe('Inspector track notes and gain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
        await expect(page.getByRole('complementary', { name: 'Inspector panel', exact: true })).toBeVisible();
    });

    test('track notes persist after blur', async ({ page }) => {
        const notes = page.getByRole('textbox', { name: /^Notes for MIDI/ });
        await expect(notes).toHaveValue('');
        await notes.fill('This is a test note');
        await notes.blur();
        await expect(notes).toHaveValue('This is a test note');
    });

    test('MIDI gain starts at 80 and steps up', async ({ page }) => {
        const gain = page.getByTestId('inspector-track-gain').getByRole('slider');
        await expect(gain).toHaveAttribute('aria-valuenow', '80');
        await gain.focus();
        await page.keyboard.press('ArrowRight');
        await expect(gain).toHaveAttribute('aria-valuenow', '81');
    });
});
