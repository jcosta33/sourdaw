import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiClipAndOpenInspector(page: Page): Promise<void> {
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
    const grooveSource = inspector.getByRole('button', {
        name: 'Select or drag New midi clip as groove source',
        exact: true,
    });
    await expect(grooveSource).toBeVisible();
    await grooveSource.click();
    await expect(inspector.getByRole('slider', { name: 'Trim clip start' })).toBeVisible();
}

test.describe('Clip inspector Trim start', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiClipAndOpenInspector(page);
    });

    test('ArrowUp steps Trim clip start by 0.25', async ({ page }) => {
        const trimStart = page.getByRole('slider', { name: 'Trim clip start' });
        const before = Number(await trimStart.getAttribute('aria-valuenow'));
        expect(Number.isFinite(before)).toBe(true);

        await trimStart.scrollIntoViewIfNeeded();
        await trimStart.press('ArrowUp');
        await expect.poll(async () => Number(await trimStart.getAttribute('aria-valuenow'))).toBe(before + 0.25);
    });
});
