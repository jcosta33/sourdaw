import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
}

function armButtons(page: Page) {
    return page.locator('[data-testid^="track-arm-"]');
}

test.describe('Track arm', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('arm button is present and not armed', async ({ page }) => {
        const arm = armButtons(page).first();
        await expect(arm).toBeVisible();
        await expect(arm).toHaveAttribute('data-active', 'false');
        await expect(arm).toHaveAttribute('aria-label', /^Arm /);
    });

    test('arming a track sets data-active to true', async ({ page }) => {
        const arm = armButtons(page).first();
        await expect(arm).toBeVisible();
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'true');
        await expect(arm).toHaveAttribute('aria-label', /^Disarm /);
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'false');
        await expect(arm).toHaveAttribute('aria-label', /^Arm /);
    });

    test('arming one track does not arm another', async ({ page }) => {
        await addMidiTrack(page);
        const arms = armButtons(page);
        await expect(arms).toHaveCount(2);
        await arms.nth(0).click();
        await expect(arms.nth(0)).toHaveAttribute('data-active', 'true');
        await expect(arms.nth(1)).toHaveAttribute('data-active', 'false');
    });

    test('arming then disarming leaves all tracks unarmed', async ({ page }) => {
        await addMidiTrack(page);
        const arms = armButtons(page);
        await expect(arms).toHaveCount(2);
        await arms.nth(0).click();
        await arms.nth(1).click();
        await expect(arms.nth(0)).toHaveAttribute('data-active', 'true');
        await expect(arms.nth(1)).toHaveAttribute('data-active', 'true');
        await arms.nth(0).click();
        await arms.nth(1).click();
        await expect(arms.nth(0)).toHaveAttribute('data-active', 'false');
        await expect(arms.nth(1)).toHaveAttribute('data-active', 'false');
    });
});
