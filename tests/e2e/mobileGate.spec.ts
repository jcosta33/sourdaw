import { test, expect, type Page } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

async function expectWorkspaceReady(page: Page): Promise<void> {
    await expect(page.getByTestId('transport-play')).toBeVisible({ timeout: 20_000 });
}

// The mobile gate owns shell mounting (#1868 relocated it from the route):
// below 768px the Desktop DAW notice replaces the app, and the gate's
// monotonic latch boots the shell once the viewport widens past the
// breakpoint — the follow-up fixed a resize remount that destroyed undo
// history. Regression-prone area with only component-spec coverage.
test.describe('Mobile gate — notice and boot-on-widen', () => {
    test('narrow viewport shows the notice, widening boots the workspace', async ({ page }) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width: 700, height: 800 });
        await setupWorkspace(page);

        // Under the breakpoint the shell never mounts: the notice stands in
        // for the whole app and no transport exists.
        await expect(page.getByText('Desktop DAW')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('transport-play')).toHaveCount(0);

        // Widen past the breakpoint: the gate boots the workspace and the
        // transport appears — the real app shell, not the notice.
        await page.setViewportSize({ width: 1440, height: 900 });
        await expectWorkspaceReady(page);
        await expect(page.getByText('Desktop DAW')).toHaveCount(0);

        // Narrow back below the breakpoint: the one-way latch keeps the
        // booted shell mounted — the #1868 follow-up fixed a reactive gate
        // whose resize remount destroyed undo history.
        await page.setViewportSize({ width: 700, height: 800 });
        await page.waitForTimeout(500);
        await expect(page.getByTestId('transport-play')).toBeVisible();
        await expect(page.getByTestId('transport-play')).toHaveCount(1);
    });
});
