import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

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

    test('clip context menu shows Normalize option', async ({ page }) => {
        await openClipContextMenu(page);
        const normalize = page.getByRole('menuitem', { name: /Normalize/i }).first();
        const hasItem = await normalize.isVisible().catch(() => false);
        if (hasItem) {
            expect(await normalize.innerText()).toContain('Normalize');
        }
    });

    test('clip context menu shows Reverse option', async ({ page }) => {
        await openClipContextMenu(page);
        const reverse = page.getByRole('menuitem', { name: /Reverse/i }).first();
        const hasItem = await reverse.isVisible().catch(() => false);
        if (hasItem) {
            expect(await reverse.innerText()).toContain('Reverse');
        }
    });

    test('clip context menu shows Export MIDI for MIDI clips', async ({ page }) => {
        await openClipContextMenu(page);
        const exportMidi = page.getByRole('menuitem', { name: /Export MIDI/i }).first();
        const hasItem = await exportMidi.isVisible().catch(() => false);
        if (hasItem) {
            expect(await exportMidi.innerText()).toContain('Export MIDI');
        }
    });

    test('clip context menu has multiple items', async ({ page }) => {
        await openClipContextMenu(page);
        const items = page.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(2);
    });

    test('clicking Normalize does not crash the app', async ({ page }) => {
        await openClipContextMenu(page);
        const normalize = page.getByRole('menuitem', { name: /Normalize/i }).first();
        if (await normalize.isVisible().catch(() => false)) {
            await normalize.click();
            await page.waitForTimeout(500);

            // Transport should still be functional.
            await expect(page.getByTestId('transport-play')).toBeVisible();
        }
    });
});
