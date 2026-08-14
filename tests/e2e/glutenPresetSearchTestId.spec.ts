import { test, expect, type Page } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// The "Drum Bus" track and its Gluten device "Drum Glue" come from the Pop Song
// template (the EDM template carries no Gluten device on main). Same open path
// as deviceKnobKeyboardTestId.spec.ts: select the track, click the device entry.
async function openGlutenPanel(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const drumBus = trackList.getByRole('row').filter({ hasText: /Drum Bus/i }).first();
    await drumBus.click();
    await page.waitForTimeout(500);

    await page.getByText('Drum Glue', { exact: false }).first().click();
    await page.waitForTimeout(800);
    // The panel mounts named knobs as role="slider".
    await expect(page.getByRole('slider', { name: 'Threshold' })).toBeVisible({ timeout: 10_000 });
}

// The Presets rail header renders a live "<n> ready" LED driven by the filtered
// preset list, so its text is the panel's own computed match count.
async function readyCount(page: Page): Promise<number> {
    const led = page.getByText(/^\d+ ready$/, { exact: true });
    const text = await led.textContent();
    if (text === null) {
        throw new Error('Gluten preset readiness LED not found');
    }
    return Number(text.trim().split(' ')[0]);
}

test.describe('Gluten panel — preset search filtering', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
        await openGlutenPanel(page);
    });

    test('narrow query drops the preset count and clearing restores it', async ({ page }) => {
        const search = page.getByLabel('Search Gluten presets');
        await expect(search).toBeVisible();

        const baseline = await readyCount(page);
        expect(baseline).toBeGreaterThan(3);

        // "Opto" matches exactly the three Opto presets (Opto Vocal, Opto
        // Leveler, Opto Limiter); everything else drops out of the list.
        await search.fill('Opto');
        await expect.poll(() => readyCount(page)).toBe(3);
        await expect(page.getByRole('button', { name: /Opto Vocal/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Bus Glue/ })).toBeHidden();

        await search.fill('');
        await expect.poll(() => readyCount(page)).toBe(baseline);
        await expect(page.getByRole('button', { name: /Bus Glue/ })).toBeVisible();
    });
});
