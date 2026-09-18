import { test, expect } from '@playwright/test';

import { add_midi_track, launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Recording Transport', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can toggle global transport recording', async ({ page }) => {
        // Find the transport bar Record button (not the empty state one)
        // Since it's a latch button, we can find it by its ARIA pressed state or its precise name.
        // Sourdaw sets aria-label to 'Record' or 'Stop recording'
        const recordButton = page
            .getByRole('button', { name: 'Record', exact: true })
            .or(page.getByRole('button', { name: 'Stop recording', exact: true }));
        // A fresh project starts with zero tracks; add one before arming (#4299).
        await add_midi_track(page);

        // Arm the first track so Record has an eligible target (#3679).
        const armButton = page.locator('[data-testid^="track-arm-"]').first();
        await armButton.click({ timeout: 15_000 });
        await expect(recordButton).toBeVisible();

        // Ensure it's not recording initially
        await expect(recordButton).toHaveAttribute('aria-pressed', 'false');

        // Click Record
        await recordButton.click();

        // The button state should update
        await expect(recordButton).toHaveAttribute('aria-pressed', 'true');

        // Stop Recording
        await recordButton.click();

        // The button state should revert
        await expect(recordButton).toHaveAttribute('aria-pressed', 'false');
    });
});
