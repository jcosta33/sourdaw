import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Clip Operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can copy, paste, duplicate, and delete a clip via context menu', async ({ page }) => {
        // 1. Create a track
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();

        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        // 2. Create a clip
        await canvas.click({ button: 'right', position: { x: 200, y: 30 }, force: true });
        const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClipItem).toBeVisible();
        await addClipItem.click();

        await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
        await canvas.click({ position: { x: 220, y: 30 } });
        const dockToggle = page.getByTestId('toggle-bottom-dock');
        if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
            await dockToggle.click();
        }
        await page.getByRole('tab', { name: 'Editor', exact: true }).click();
        const clipCount = page.getByTestId('selected-track-clip-count');
        await expect(clipCount).toHaveText('1 clip');

        // 3. Copy clip
        // Click firmly inside the clip (starts at x=200, ends at x=248)
        await canvas.click({ button: 'right', position: { x: 220, y: 30 }, force: true });
        const copyItem = page.getByRole('menuitem', { name: /Copy/i });
        await expect(copyItem).toBeVisible();
        await copyItem.click();
        await expect(clipCount).toHaveText('1 clip');

        // 4. Paste clip at a different position
        await canvas.click({ button: 'right', position: { x: 400, y: 30 }, force: true });
        const pasteItem = page.getByRole('menuitem', { name: /Paste/i });
        await expect(pasteItem).toBeVisible();
        await pasteItem.click();
        await expect(clipCount).toHaveText('2 clips');

        // 5. Exercise the main Duplicate action, distinct from Duplicate to Next Bar.
        await canvas.click({ button: 'right', position: { x: 220, y: 30 }, force: true });
        const duplicateItem = page.getByRole('menuitem', { name: /^Duplicate(?:\s+⌘D)?$/ });
        await expect(duplicateItem).toBeVisible();
        await duplicateItem.click();
        await expect(clipCount).toHaveText('3 clips');

        // 6. Delete the original clip.
        await canvas.click({ button: 'right', position: { x: 220, y: 30 }, force: true });
        const deleteItem = page.getByRole('menuitem', { name: /Delete/i }).filter({ hasText: /Delete/ });
        await expect(deleteItem).toBeVisible();
        await deleteItem.click();
        await expect(clipCount).toHaveText('2 clips');
    });
});
