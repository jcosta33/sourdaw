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

async function addMidiClip(page: Page): Promise<void> {
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
}

test.describe('Clip delete', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await addMidiTrack(page);
        await addMidiClip(page);
    });

    test('Backspace removes the selected MIDI clip', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const clipInInspector = inspector.getByRole('button', {
            name: 'Select or drag New midi clip as groove source',
            exact: true,
        });
        await expect(clipInInspector).toBeVisible();

        await canvas.click({ position: { x: 300, y: 30 } });
        await page.keyboard.press('Backspace');
        await expect(clipInInspector).toHaveCount(0);
        await expect(inspector.getByText(/Clips \(0\)/)).toBeVisible();
    });
});
