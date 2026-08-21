import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

function modulationMatrix(page: Page) {
    return page.getByRole('region', { name: 'Modulation matrix' });
}

test.describe('Modulation matrix — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
        await openBottomTab(page, 'Modulation');
    });

    test('modulation tab is selected in the bottom dock', async ({ page }) => {
        const tab = page
            .getByRole('tablist', { name: 'Bottom dock' })
            .getByRole('tab', { name: 'Modulation', exact: true });
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
    });

    test('New Modulator button is present via test ID', async ({ page }) => {
        const newBtn = page.getByRole('button', { name: 'New Modulator' });
        await expect(newBtn).toBeVisible();
        await expect(newBtn).toHaveAttribute('data-testid', 'modulation-new-button');
        await expect(newBtn).toHaveAttribute('aria-expanded', 'false');
    });

    test('clicking New Modulator opens the create form', async ({ page }) => {
        const newBtn = page.getByTestId('modulation-new-button');
        await expect(newBtn).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByLabel('Modulator name')).toHaveCount(0);

        await newBtn.click();

        await expect(newBtn).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByLabel('Modulator name')).toBeVisible();
        await expect(page.getByLabel('Modulator kind')).toBeVisible();
    });

    test('modulation matrix shows the empty state', async ({ page }) => {
        await expect(modulationMatrix(page)).toBeVisible();
        await expect(page.getByText('No modulators')).toBeVisible();
    });

    test('adding an LFO replaces the empty state with a named modulator', async ({ page }) => {
        await expect(page.getByText('No modulators')).toBeVisible();

        await page.getByTestId('modulation-new-button').click();
        await modulationMatrix(page).getByRole('button', { name: 'Add' }).click();

        await expect(page.getByText('No modulators')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Remove modulator LFO' })).toBeVisible();
    });
});
