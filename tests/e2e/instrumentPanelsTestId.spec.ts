import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const PANEL_OPEN_TIMEOUT_MS = 30_000;

const INSTRUMENTS = [
    { card: 'Fermenter', panel: 'Fermenter' },
    { card: 'Crumbs', panel: 'Sampler' },
    { card: 'Levain', panel: 'Levain' },
] as const;

async function openInstrumentPanel(
    page: Page,
    card: (typeof INSTRUMENTS)[number]['card'],
    panel: (typeof INSTRUMENTS)[number]['panel']
): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: new RegExp(`^${card}`) }).click();
    await expect(page.getByRole('button', { name: `Close ${panel}` })).toBeVisible({
        timeout: PANEL_OPEN_TIMEOUT_MS,
    });
}

test.describe('Instrument device panels — Fermenter, Levain, Crumbs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    for (const { card, panel } of INSTRUMENTS) {
        test(`${card} card opens the ${panel} panel and Close dismisses it`, async ({ page }) => {
            const close = page.getByRole('button', { name: `Close ${panel}` });
            await expect(close).toHaveCount(0);

            await openInstrumentPanel(page, card, panel);
            await expect(close).toBeVisible();

            await close.click();
            await expect(close).toHaveCount(0);
        });
    }
});
