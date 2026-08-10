import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// The transport playhead readout is a segmented display whose label and format
// switch between musical (Bars) and wall-clock (Time) on click. The toggle is
// the readout's own onClick (toggleTimeDisplayMode); no E2E covered it. This
// asserts the real state change: the label swaps Bars ↔ Time.
test.describe('Transport time-display toggle — Bars ↔ Time', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('clicking the playhead readout swaps the label between Bars and Time', async ({ page }) => {
        const playhead = page.getByRole('button', { name: /Playhead position/i });

        // Default is musical: the readout is labelled "Bars".
        await expect(playhead).toBeVisible();
        await expect(playhead.getByText('Bars')).toBeVisible();

        // Toggle to wall-clock: the label becomes "Time".
        await playhead.click();
        await page.waitForTimeout(300);
        await expect(playhead.getByText('Time')).toBeVisible();
        await expect(playhead.getByText('Bars')).toHaveCount(0);

        // Toggle back restores the musical label.
        await playhead.click();
        await page.waitForTimeout(300);
        await expect(playhead.getByText('Bars')).toBeVisible();
        await expect(playhead.getByText('Time')).toHaveCount(0);
    });
});
