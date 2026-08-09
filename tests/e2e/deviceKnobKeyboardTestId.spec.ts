import { test, expect } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Open the Gluten (bus compressor) panel by selecting a track that carries one
// and clicking its device entry in the device chain. Returns once a named knob
// is reachable.
async function openGlutenPanel(page: import('@playwright/test').Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const drumBus = trackList.getByRole('row').filter({ hasText: /Drum Bus/i }).first();
    await drumBus.click();
    await page.waitForTimeout(500);

    await page.getByText('Drum Glue', { exact: false }).first().click();
    await page.waitForTimeout(800);
    // The panel mounts named knobs as role="slider".
    await expect(page.getByRole('slider', { name: 'Threshold' })).toBeVisible({ timeout: 10_000 });
}

test.describe('Device parameter knob — keyboard increment (Gluten)', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
        await openGlutenPanel(page);
    });

    test('ArrowUp increments aria-valuenow', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Threshold' }).first();
        await knob.focus();

        const before = Number(await knob.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        const after = Number(await knob.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('ArrowDown decrements aria-valuenow', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Threshold' }).first();
        await knob.focus();

        // Nudge up first so there is room to come back down unambiguously.
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const raised = Number(await knob.getAttribute('aria-valuenow'));

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        const lowered = Number(await knob.getAttribute('aria-valuenow'));
        expect(lowered).toBeLessThan(raised);
    });

    test('Home sets the knob to its minimum', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Threshold' }).first();
        const min = Number(await knob.getAttribute('aria-valuemin'));

        await knob.focus();
        await page.keyboard.press('End'); // push to max first
        await page.waitForTimeout(200);
        await page.keyboard.press('Home');
        await page.waitForTimeout(200);

        const after = Number(await knob.getAttribute('aria-valuenow'));
        expect(after).toBe(min);
    });

    test('End sets the knob to its maximum', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Threshold' }).first();
        const max = Number(await knob.getAttribute('aria-valuemax'));

        await knob.focus();
        await page.keyboard.press('Home'); // floor it first
        await page.waitForTimeout(200);
        await page.keyboard.press('End');
        await page.waitForTimeout(200);

        const after = Number(await knob.getAttribute('aria-valuenow'));
        expect(after).toBe(max);
    });
});
