import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Command Palette', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Load the empty project
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-new-project').click();

        // Wait for the workspace to initialize
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Can open the command palette and execute a command', async ({ page }) => {
        // Press 'Cmd+K' / 'Ctrl+K' to open the Command Palette
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const palette = page.getByRole('dialog', { name: /Command Palette/i });
        await expect(palette).toBeVisible();

        const input = palette.getByPlaceholder(/Type a command/i);
        await expect(input).toBeFocused();

        // Search for a command
        await input.fill('Add Audio Track');

        // Wait for the list to filter
        const option = palette.getByRole('option', { name: /Add Audio Track/i });
        await expect(option).toBeVisible();

        // Execute by pressing Enter
        await page.keyboard.press('Enter');

        // The palette should close
        await expect(palette).not.toBeVisible();

        // Verify the command was executed by checking if an Audio track was created
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const newTrackRow = trackList.getByRole('row').filter({ hasText: /Audio/i }).first();
        await expect(newTrackRow).toBeVisible();
    });

    test('Enter selects and runs the top match after the cursor hovered a now-filtered-out option', async ({
        page,
    }) => {
        // Regression guard for the hover/keyboard-nav desync: hovering an option in
        // the full (unfiltered) list bumped selectedIndex high; filtering the list
        // down then left that index out of range, so the Enter handler's
        // `results[selectedIndex]` guard was undefined and Enter silently did
        // nothing — the palette stayed open and the command never ran. The contract
        // proven here is the part the bug broke: after hover + filter the top match
        // is the active selection and pressing Enter runs it and closes the palette.
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const palette = page.getByRole('dialog', { name: /Command Palette/i });
        await expect(palette).toBeVisible();

        const input = palette.getByPlaceholder(/Type a command/i);
        await expect(input).toBeFocused();

        // With an empty query the full catalog is listed. Move the pointer onto a
        // deep-in-the-list option so the keyboard selection index is bumped high.
        const hoverTarget = palette.getByRole('option', { name: /Toggle Metronome/i });
        await expect(hoverTarget).toBeVisible();
        await hoverTarget.hover();

        // Now filter the list down so the previously hovered index is out of range
        // for the new, shorter results.
        await input.fill('Add Audio Track');

        // The top match must be the active selection — not a stale hovered index.
        const topMatch = palette.getByRole('option', { name: /Add Audio Track/i });
        await expect(topMatch).toBeVisible();
        await expect(topMatch).toHaveAttribute('aria-selected', 'true');

        // Keyboard focus stayed on the input; pressing Enter must run the active
        // selection and close the palette (the bug left it open).
        await page.keyboard.press('Enter');
        await expect(palette).not.toBeVisible();
    });
});
