import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openTab(page: Page, tabId: string): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    const tab = page.locator(`#bottom-dock-tab-${tabId}`);
    if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Loop station controls — fixed length & stop all (state depth)', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'EDM' });
        await openTab(page, 'loopStation');
    });

    test('fixed loop length input commits and persists a new value', async ({ page }) => {
        const fixed = page.getByRole('spinbutton', { name: /Fixed loop length/i });
        await expect(fixed).toBeVisible();
        // Default is 0 (auto-detect).
        await expect(fixed).toHaveValue('0');

        // Enter a positive length and commit with Enter; the commit path updates
        // the store and re-syncs the input to the committed value.
        await fixed.fill('12');
        await fixed.press('Enter');
        await expect(fixed).toHaveValue('12');
    });

    test('fixed loop length clamps a negative entry to zero on commit', async ({ page }) => {
        const fixed = page.getByRole('spinbutton', { name: /Fixed loop length/i });
        await expect(fixed).toHaveValue('0');

        // commitFixedLoopLength runs Math.max(0, parsed); only the commit
        // round-trip can turn "-7" into "0" (a bare echo would leave "-7").
        await fixed.fill('-7');
        await fixed.press('Enter');
        await expect(fixed).toHaveValue('0');
    });

    test('stop all transitions a playing slot to stopped', async ({ page }) => {
        const region = page.getByRole('region', { name: 'Loop station' });

        // Create one slot in the first track's row 1.
        await region.getByRole('button', { name: 'Create loop slot row 1' }).first().click();
        await page.waitForTimeout(200);

        // empty -> recording.
        const record = region.getByRole('button', { name: 'Record or overdub slot 1' });
        await record.click();
        await page.waitForTimeout(200);
        await expect(region.getByText('Rec', { exact: true })).toBeVisible();

        // recording -> playing (records the first layer).
        await record.click();
        await page.waitForTimeout(200);
        await expect(region.getByText('Play', { exact: true })).toBeVisible();

        // stopAllSlots maps playing -> stopped; observe the slot state label.
        await page.getByRole('button', { name: 'Stop all loops' }).click();
        await page.waitForTimeout(300);
        await expect(region.getByText('Stop', { exact: true })).toBeVisible();
        await expect(region.getByText('Play', { exact: true })).toHaveCount(0);
    });
});
