import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

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

test.describe('MIDI overdub arm', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await addMidiTrack(page);
    });

    test('arming a MIDI track mounts Overdub and disarming removes it', async ({ page }) => {
        const overdub = page.getByRole('button', { name: 'Overdub', exact: true });
        await expect(overdub).toHaveCount(0);

        await page.getByRole('button', { name: /^Arm MIDI/ }).click();
        await expect(page.getByRole('button', { name: /^Disarm MIDI/ })).toBeVisible();
        await expect(overdub).toBeVisible();
        await expect(overdub).not.toHaveAttribute('aria-pressed', 'true');

        await overdub.click();
        await expect(overdub).toHaveAttribute('aria-pressed', 'true');

        await page.getByRole('button', { name: /^Disarm MIDI/ }).click();
        await expect(overdub).toHaveCount(0);
    });
});
