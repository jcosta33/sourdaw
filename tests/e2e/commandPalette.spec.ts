import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Command Palette', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
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
        await expect(option).toHaveAttribute('aria-selected', 'true');

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
        // Observe the transport control fed by transport.metronomeEnabled, so
        // closing the palette without dispatching cannot satisfy this case.
        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const palette = page.getByRole('dialog', { name: /Command Palette/i });
        await expect(palette).toBeVisible();

        const input = palette.getByPlaceholder(/Type a command/i);
        await expect(input).toBeFocused();

        // With an empty query a small discovery set is listed. Move the pointer
        // beyond the first suggestion so the keyboard selection index is bumped.
        const hoverTarget = palette.getByRole('option', { name: /Add Audio Track/i });
        await expect(hoverTarget).toBeVisible();
        await hoverTarget.hover();

        // Now filter the list down so the previously hovered index is out of range
        // for the new, shorter results.
        await input.fill('Toggle Metronome');

        // The top match must be the active selection — not a stale hovered index.
        const topMatch = palette.getByRole('option', { name: /Toggle Metronome/i });
        await expect(topMatch).toBeVisible();
        await expect(topMatch).toHaveAttribute('aria-selected', 'true');

        // Keyboard focus stayed on the input; pressing Enter must run the active
        // selection and close the palette (the bug left it open).
        await page.keyboard.press('Enter');
        await expect(palette).not.toBeVisible();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');
    });
});
