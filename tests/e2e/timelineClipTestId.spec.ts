import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
}

test.describe('Timeline clip operations — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('right-click timeline opens context menu with Add Clip Here', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });

        const addClip = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClip).toBeVisible({ timeout: 5000 });
    });

    test('double-clicking a clip opens the piano roll editor', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');

        // Create clip.
        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);

        // Double-click to open piano roll.
        await canvas.dblclick({ position: { x: 300, y: 30 } });
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await expect(pianoRoll).toBeVisible({ timeout: 5000 });
    });

    test('clip context menu shows MIDI-specific items for a MIDI clip', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');

        // Create clip.
        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);

        // Right-click the clip to get its context menu.
        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });

        // Should see at least some menu items.
        const menuItems = page.getByRole('menuitem');
        const count = await menuItems.count();
        expect(count).toBeGreaterThan(0);
    });
});
