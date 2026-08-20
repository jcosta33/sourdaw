import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
}

function inspector(page: Page) {
    return page.getByRole('complementary', { name: 'Inspector panel' });
}

async function addNamedDevice(page: Page, device: string): Promise<void> {
    const panel = inspector(page);
    await panel.getByRole('button', { name: 'Add device' }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${device}$`) }).click();
    await expect(panel.getByRole('button', { name: new RegExp(`^Bypass ${device}$`, 'i') })).toBeVisible();
}

test.describe('Effect device chain — Gluten and Grinder', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('adding Gluten via inspector add-device creates a bypass toggle', async ({ page }) => {
        await addNamedDevice(page, 'Gluten');
        await expect(inspector(page).getByRole('button', { name: 'Bypass Gluten' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });

    test('bypassing a device toggles aria-pressed', async ({ page }) => {
        await addNamedDevice(page, 'Gluten');
        const panel = inspector(page);
        await panel.getByRole('button', { name: 'Bypass Gluten' }).click();
        await expect(panel.getByRole('button', { name: 'Enable Gluten' })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Enable Gluten' })).toHaveAttribute('aria-pressed', 'true');
        await panel.getByRole('button', { name: 'Enable Gluten' }).click();
        await expect(panel.getByRole('button', { name: 'Bypass Gluten' })).toHaveAttribute('aria-pressed', 'false');
    });

    test('removing a device decreases device card count', async ({ page }) => {
        await addNamedDevice(page, 'Gluten');
        await addNamedDevice(page, 'Grinder');
        const panel = inspector(page);
        await expect(panel.getByRole('button', { name: 'Bypass Gluten' })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Bypass Grinder' })).toBeVisible();
        await panel.getByRole('button', { name: 'Remove Gluten' }).click();
        await expect(panel.getByRole('button', { name: 'Bypass Gluten' })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Bypass Grinder' })).toBeVisible();
    });

    test('device chain add button remains functional after adding and removing', async ({ page }) => {
        await addNamedDevice(page, 'Gluten');
        const panel = inspector(page);
        await panel.getByRole('button', { name: 'Remove Gluten' }).click();
        await expect(panel.getByRole('button', { name: 'Bypass Gluten' })).toHaveCount(0);
        await addNamedDevice(page, 'Grinder');
        await expect(panel.getByRole('button', { name: 'Bypass Grinder' })).toBeVisible();
    });
});
