import { type Page } from '@playwright/test';

import { test, expect } from './e2eTest';
import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// The "Drum Bus" track and its Gluten device "Drum Glue" come from the Pop Song
// template (the EDM template carries no Gluten device on main). Same open path
// as deviceKnobKeyboardTestId.spec.ts: select the track, click the device entry.
async function openGlutenPanel(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const drumBus = trackList
        .getByRole('row')
        .filter({ hasText: /Drum Bus/i })
        .first();
    await drumBus.click();

    await page.getByText('Drum Glue', { exact: false }).first().click();
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

    test('control detail reveals cumulative controls and retains the current values', async ({ page }) => {
        const disclosure = page.getByRole('group', { name: 'Effect control detail' });
        await expect(disclosure.getByRole('button', { name: 'play', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        const threshold = page.getByRole('slider', { name: 'Threshold', exact: true });
        const before = await threshold.getAttribute('aria-valuenow');
        if (before === null) {
            throw new Error('The Threshold control must expose its current value');
        }
        await expect(page.getByRole('slider', { name: 'Attack', exact: true })).toHaveCount(0);
        await disclosure.getByRole('button', { name: 'shape', exact: true }).click();
        await expect(page.getByRole('slider', { name: 'Attack', exact: true })).toBeVisible();
        await expect(threshold).toBeVisible();
        await disclosure.getByRole('button', { name: 'lab', exact: true }).click();
        await expect(page.getByRole('button', { name: '4×', exact: true })).toBeVisible();
        await expect(page.getByRole('slider', { name: 'SC HPF', exact: true })).toBeVisible();
        await disclosure.getByRole('button', { name: 'play', exact: true }).click();
        await expect(page.getByRole('slider', { name: 'Attack', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '4×', exact: true })).toHaveCount(0);
        await expect(threshold).toHaveAttribute('aria-valuenow', before);
        await expect(page.getByLabel('Search Gluten presets')).toBeVisible();
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

    test('uses the wide layout by default and contains stacked content at narrow widths', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const faceplate = page.locator('.gluten-faceplate');
        const workspace = faceplate.locator(':scope > div').first();
        const panelBody = page.getByTestId('instrument-bottom-panel-body').filter({ has: faceplate });
        const defaultGeometry = await faceplate.evaluate((element) => ({
            width: element.getBoundingClientRect().width,
            columns: getComputedStyle(element.firstElementChild as Element).gridTemplateColumns,
            viewport: window.innerWidth,
        }));
        expect(defaultGeometry.width, JSON.stringify(defaultGeometry)).toBeGreaterThanOrEqual(896);
        await expect
            .poll(() =>
                workspace.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
            )
            .toBe(3);

        const disclosure = page.getByRole('group', { name: 'Effect control detail' });
        await disclosure.getByRole('button', { name: 'lab', exact: true }).click();
        await expect(page.getByRole('slider', { name: 'SC HPF', exact: true })).toBeVisible();

        for (const label of ['Gluten dynamics overview', 'Gluten controls']) {
            const column = page.getByLabel(label, { exact: true });
            await expect.poll(() => column.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(440);
        }

        const controls = page.getByLabel('Gluten controls', { exact: true });
        await expect
            .poll(() => controls.evaluate((element) => element.scrollHeight - element.clientHeight))
            .toBeGreaterThan(0);
        await controls.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await expect.poll(() => controls.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

        await page.setViewportSize({ width: 900, height: 700 });
        await expect
            .poll(() =>
                workspace.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
            )
            .toBe(1);
        await expect
            .poll(() =>
                faceplate.evaluate((element) => {
                    const content = element.firstElementChild;
                    if (!content) {
                        throw new Error('Expected the Gluten workspace grid');
                    }
                    return element.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom;
                })
            )
            .toBeGreaterThanOrEqual(-1);
        await expect
            .poll(() => panelBody.evaluate((element) => element.scrollWidth - element.clientWidth))
            .toBeLessThanOrEqual(0);
    });
});
