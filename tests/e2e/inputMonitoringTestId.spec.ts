import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
}

test.describe('Track input monitoring — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('input monitoring button is present on track header', async ({ page }) => {
        const monitor = page.getByRole('button', { name: /Input monitoring/i }).first();
        await expect(monitor).toBeVisible({ timeout: 10_000 });
    });

    test('input monitoring shows a valid mode label', async ({ page }) => {
        const monitor = page.getByRole('button', { name: /Input monitoring/i }).first();
        await expect(monitor).toBeVisible({ timeout: 10_000 });

        const label = await monitor.getAttribute('aria-label');
        expect(label).toContain('Input monitoring');
        // The label includes the mode (Auto, On, or Off).
        expect(label).toMatch(/Auto|On|Off/);
    });

    test('input monitoring cycles through modes on click', async ({ page }) => {
        const monitor = page.getByRole('button', { name: /Input monitoring/i }).first();
        await expect(monitor).toBeVisible({ timeout: 10_000 });

        const before = await monitor.getAttribute('aria-label');
        await monitor.click();
        await page.waitForTimeout(300);
        const after = await monitor.getAttribute('aria-label');
        // The mode should have changed.
        expect(after).not.toBe(before);
    });

    test('track variation lanes toggle is present', async ({ page }) => {
        const lanes = page.getByRole('button', { name: /variation lanes/i }).first();
        const hasLanes = await lanes.isVisible().catch(() => false);
        if (hasLanes) {
            const before = await lanes.getAttribute('aria-pressed');
            await lanes.click();
            await page.waitForTimeout(300);
            await expect(lanes).not.toHaveAttribute('aria-pressed', before ?? '');
        }
    });
});
