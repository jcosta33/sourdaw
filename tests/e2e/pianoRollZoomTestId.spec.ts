import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPianoRoll(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.locator('[aria-label="Piano roll editor"]')).toBeVisible();
}

test.describe('Piano roll zoom & snap — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPianoRoll(page);
    });

    test('clicking a snap button changes the active variant', async ({ page }) => {
        // 1/16 should be active by default (gridSnap 0.25 beats = 1/16 note).
        const snap16 = page.getByRole('button', { name: '1/16', exact: true });
        await expect(snap16).toBeVisible({ timeout: 5000 });

        // Click 1/32 (gridSnap 0.125 beats).
        const snap32 = page.getByRole('button', { name: '1/32', exact: true });
        await snap32.click();
        await expect(snap32).toHaveAttribute('aria-pressed', 'true');
        await expect(snap16).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByRole('slider', { name: 'Piano roll zoom' })).toBeVisible();
        await snap16.click();
        await expect(snap16).toHaveAttribute('aria-pressed', 'true');
        await expect(snap32).toHaveAttribute('aria-pressed', 'false');
    });
});
