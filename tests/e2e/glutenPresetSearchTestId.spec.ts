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

    test('scrolls to the last control card in both wide and stacked layouts', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const dialog = page.getByRole('dialog', { name: 'Gluten', exact: true });
        const panelBody = dialog.getByTestId('floating-device-panel-body');
        const workspace = panelBody.getByRole('region', { name: 'Gluten workspace', exact: true });
        const grid = workspace.locator(':scope > div').first();
        const disclosure = workspace.getByRole('group', { name: 'Effect control detail' });
        await disclosure.getByRole('button', { name: 'lab', exact: true }).click();
        await expect(workspace.getByRole('slider', { name: 'SC HPF', exact: true })).toBeVisible();

        const stageTwo = workspace.locator('section').filter({
            has: page.getByText('Stage two', { exact: true }),
        });
        const fet = stageTwo.getByRole('button', { name: 'FET', exact: true });
        await expect(fet).toBeEnabled();

        for (const layout of [
            { width: 1440, height: 900, columns: 3 },
            { width: 900, height: 700, columns: 1 },
        ]) {
            await test.step(`${layout.columns}-column workspace`, async () => {
                await page.setViewportSize({ width: layout.width, height: layout.height });
                await expect
                    .poll(() =>
                        grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
                    )
                    .toBe(layout.columns);
                if (layout.columns === 3) {
                    await expect
                        .poll(() => workspace.evaluate((element) => element.getBoundingClientRect().width))
                        .toBeGreaterThanOrEqual(896);
                } else {
                    await expect
                        .poll(() => panelBody.evaluate((element) => element.scrollWidth - element.clientWidth))
                        .toBe(0);
                    await expect
                        .poll(() => workspace.evaluate((element) => element.scrollWidth - element.clientWidth))
                        .toBe(0);
                }

                const readWorkspaceScroll = () => workspace.evaluate((element) => element.scrollTop);
                await expect.poll(readWorkspaceScroll).toBe(0);
                await expect(fet).not.toBeInViewport();

                // Wheel over the workspace padding to avoid targeting a nested scroll area.
                const point = await workspace.evaluate((element) => {
                    const bounds = element.getBoundingClientRect();
                    const padding = Number.parseFloat(getComputedStyle(element).paddingLeft);
                    const x = bounds.left + element.clientLeft + padding / 2;
                    const y = bounds.top + Math.min(100, element.clientHeight / 2);
                    return { x, y, hitsWorkspace: document.elementFromPoint(x, y) === element };
                });
                expect(point.hitsWorkspace).toBe(true);
                await page.mouse.move(point.x, point.y);
                await page.mouse.wheel(0, 5000);

                await expect.poll(readWorkspaceScroll).toBeGreaterThan(0);
                await expect(stageTwo).toBeInViewport({ ratio: 0.99 });
                await expect
                    .poll(() =>
                        fet.evaluate((element) => {
                            const { left, top, width, height } = element.getBoundingClientRect();
                            return element.contains(document.elementFromPoint(left + width / 2, top + height / 2));
                        })
                    )
                    .toBe(true);
                expect(await panelBody.evaluate((element) => element.scrollTop)).toBe(0);

                if (layout.columns === 3) {
                    await page.mouse.wheel(0, -5000);
                    await expect.poll(readWorkspaceScroll).toBe(0);
                }
            });
        }
    });
});
