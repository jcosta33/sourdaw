import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
}

async function openPianoRollOnNewClip(page: Page): Promise<void> {
    await addMidiTrack(page);
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
}

test.describe('Piano roll scale selectors', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await openPianoRollOnNewClip(page);
    });

    test('scale root changes from C to D#', async ({ page }) => {
        const root = page.getByRole('combobox', { name: 'Scale root note', exact: true });
        await expect(root).toHaveValue('0');
        await root.selectOption({ label: 'D#' });
        await expect(root).toHaveValue('3');
    });

    test('scale type changes from chromatic to minor', async ({ page }) => {
        const type = page.getByRole('combobox', { name: 'Scale type', exact: true });
        await expect(type).toHaveValue('chromatic');
        await type.selectOption('minor');
        await expect(type).toHaveValue('minor');
    });
});
