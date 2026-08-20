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
    await trackList
        .getByRole('row')
        .filter({ has: page.getByText('MIDI', { exact: true }) })
        .first()
        .click();
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

function inspector(page: Page) {
    return page.getByRole('complementary', { name: 'Inspector panel' });
}

test.describe('Modulation matrix form', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
        await openBottomTab(page, 'Modulation');
    });

    test('New Modulator toggles the form open and closed', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        const newBtn = matrix.getByRole('button', { name: 'New Modulator', exact: true });
        const nameField = matrix.getByRole('textbox', { name: 'Modulator name' });

        await expect(newBtn).toHaveAttribute('aria-expanded', 'false');
        await expect(nameField).toHaveCount(0);

        await newBtn.click();
        await expect(newBtn).toHaveAttribute('aria-expanded', 'true');
        await expect(nameField).toBeVisible();
        await expect(matrix.getByRole('combobox', { name: 'Modulator kind' })).toBeVisible();

        await newBtn.click();
        await expect(newBtn).toHaveAttribute('aria-expanded', 'false');
        await expect(nameField).toHaveCount(0);
    });
});

test.describe('Crust device — adds a real device and opens its panel', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('Adding Crust creates a bypassable device card in the chain', async ({ page }) => {
        const panel = inspector(page);
        await expect(panel.getByRole('button', { name: /^Bypass Crust$/i })).toHaveCount(0);
        await panel.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();

        await expect(panel.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await expect(panel.getByText('Crust', { exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: /^Remove Crust$/i })).toBeVisible();
    });
});

test.describe('Gluten device', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('Adding Gluten creates a device card whose bypass toggle relabels on click', async ({ page }) => {
        const panel = inspector(page);
        await panel.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Gluten$/ }).click();

        const bypass = panel.getByRole('button', { name: /^Bypass Gluten$/i });
        await expect(bypass).toBeVisible();
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');

        await bypass.click();

        const enable = panel.getByRole('button', { name: /^Enable Gluten$/i });
        await expect(enable).toBeVisible();
        await expect(enable).toHaveAttribute('aria-pressed', 'true');
        await expect(bypass).toHaveCount(0);
    });
});
