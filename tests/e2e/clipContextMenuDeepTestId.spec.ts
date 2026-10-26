import { test, expect } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openClipContextMenu(page: import('@playwright/test').Page, x = 200, y = 40): Promise<void> {
    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ button: 'right', position: { x, y } });
    await page.waitForTimeout(300);
}

test.describe('Clip context menu deep — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    // clipNormalizeReverseTestId owns audio action survival; midiExportDownloadTestId owns the MIDI download.
    test('clip context menu has multiple items', async ({ page }) => {
        await openClipContextMenu(page);
        const items = page.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(2);
    });
});
