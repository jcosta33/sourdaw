import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// The Macros sidebar panel exposes macro recording (start/stop) — a real state
// change (aria-label flips, recording indicator appears). No E2E covers it.
test.describe('Macros panel — recording toggle', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        // Switch the browser sidebar to the Macros tab.
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browser.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }
        await browser.getByRole('button', { name: 'Macros', exact: true }).click();
        await page.waitForTimeout(400);
    });

    test('Start macro recording flips the button to Stop and reveals the recording state', async ({ page }) => {
        const startBtn = page.getByRole('button', { name: 'Start macro recording' });
        await expect(startBtn).toBeVisible({ timeout: 5000 });

        // Click Start — the aria-label flips to Stop, proving recording began.
        await startBtn.click();
        await page.waitForTimeout(300);
        const stopBtn = page.getByRole('button', { name: 'Stop macro recording' });
        await expect(stopBtn).toBeVisible({ timeout: 5000 });

        // Click Stop — it flips back to Start, ending the round-trip.
        await stopBtn.click();
        await page.waitForTimeout(300);
        await expect(page.getByRole('button', { name: 'Start macro recording' })).toBeVisible({ timeout: 5000 });
    });
});
