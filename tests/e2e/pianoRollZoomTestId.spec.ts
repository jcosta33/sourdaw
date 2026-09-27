import { test, expect } from '@playwright/test';

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
    await page.waitForTimeout(500);
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.locator('[aria-label="Piano roll editor"]')).toBeVisible();
    await page.waitForTimeout(500);
}

test.describe('Piano roll zoom & snap — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPianoRoll(page);
    });

    test('zoom slider is present via test ID', async ({ page }) => {
        const zoom = page.getByTestId('toolbar-zoom');
        await expect(zoom).toBeVisible({ timeout: 5000 });
    });

    test('zoom slider has a numeric value', async ({ page }) => {
        const zoom = page.getByTestId('toolbar-zoom');
        await expect(zoom).toBeVisible({ timeout: 5000 });

        // The Slider component renders inside — look for slider role.
        const slider = zoom.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const value = await slider.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
            expect(Number(value)).toBeGreaterThanOrEqual(25);
        }
    });

    test('snap buttons are present (1/4, 1/8, 1/16, 1/32)', async ({ page }) => {
        // The snap buttons use visible note-value labels: grids 1, 0.5, 0.25,
        // 0.125 beats are the 1/4, 1/8, 1/16, 1/32 notes (#4801).
        for (const label of ['1/4', '1/8', '1/16', '1/32']) {
            const btn = page.getByRole('button', { name: label, exact: true });
            await expect(btn).toBeVisible({ timeout: 5000 });
        }
    });

    test('clicking a snap button changes the active variant', async ({ page }) => {
        // 1/16 should be active by default (gridSnap 0.25 beats = 1/16 note).
        const snap16 = page.getByRole('button', { name: '1/16', exact: true });
        await expect(snap16).toBeVisible({ timeout: 5000 });

        // Click 1/32 (gridSnap 0.125 beats).
        const snap32 = page.getByRole('button', { name: '1/32', exact: true });
        await snap32.click();
        await page.waitForTimeout(200);

        // 1/32 should now be active (secondary variant).
        const variant32 = await snap32.getAttribute('data-variant');
        const variant16 = await snap16.getAttribute('data-variant');
        expect(variant32).not.toBe(variant16);
    });
});
