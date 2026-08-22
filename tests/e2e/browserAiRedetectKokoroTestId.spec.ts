import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openPreferencesAi(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open Preferences' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'AI execution backend' })).toBeVisible();
}

async function addMidiTrackAndClip(page: Page): Promise<void> {
    await page.locator('#main-content').click();
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);

    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await expect(
        inspector.getByRole('button', { name: 'Select or drag New midi clip as groove source', exact: true })
    ).toBeVisible();
}

test.describe('Browser AI unsupported gate', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Preferences AI shows Browser AI Unavailable and no Re-detect', async ({ page }) => {
        await openPreferencesAi(page);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Browser AI Unavailable')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Re-detect capabilities' })).toHaveCount(0);
        await expect(dialog.getByRole('status', { name: 'Browser AI capabilities' })).toHaveCount(0);
    });

    test('clip inspector AI Actions omits Vocals and the Kokoro selector', async ({ page }) => {
        await addMidiTrackAndClip(page);
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Select or drag New midi clip as groove source' }).click();

        await expect(inspector.getByText('AI Actions')).toBeVisible();
        await expect(inspector.getByText('AI Variations')).toBeVisible();
        await expect(inspector.getByText('Vocals', { exact: true })).toHaveCount(0);
        await expect(inspector.getByRole('button', { name: 'Spoken' })).toHaveCount(0);
        await expect(inspector.getByRole('combobox', { name: 'Kokoro TTS voice' })).toHaveCount(0);
    });
});
