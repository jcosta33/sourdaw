import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('panel tooltip in compact transport', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('panel tooltip stays dismissed after popover Escape until a new hover', async ({ page }) => {
        const panelTrigger = page.getByRole('button', { name: 'View and panel controls' });
        const panelDialog = page.getByRole('dialog', { name: 'View and panel controls' });
        const moreDialog = page.getByRole('dialog', { name: 'More transport controls' });
        const tooltip = page.getByRole('tooltip').filter({ hasText: 'View and panel controls' });

        await panelTrigger.click();
        await expect(panelDialog).toBeVisible();
        await panelDialog.getByRole('button', { name: 'Track list' }).click();
        await page.keyboard.press('Escape');
        await expect(panelDialog).toHaveCount(0);
        await expect(panelTrigger).toBeFocused();
        await expect(tooltip).toHaveCount(0);

        await page.getByRole('button', { name: 'More transport controls' }).click();
        await expect(moreDialog).toBeVisible();
    });

    test('panel tooltip remains readable on hover and returns on fresh keyboard focus', async ({ page }) => {
        const panelTrigger = page.getByRole('button', { name: 'View and panel controls' });
        const tooltip = page.getByRole('tooltip').filter({ hasText: 'View and panel controls' });

        await panelTrigger.hover();
        await expect(tooltip).toBeVisible();
        const bounds = await tooltip.boundingBox();
        if (bounds === null) {
            throw new Error('The View and panel controls tooltip has no pointer target');
        }
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
        await expect(tooltip).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);

        await page.mouse.move(0, 0);
        await panelTrigger.click();
        await expect(page.getByRole('dialog', { name: 'View and panel controls' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panelTrigger).toBeFocused();
        await expect(tooltip).toHaveCount(0);
        await page.keyboard.press('Tab');
        await expect(panelTrigger).not.toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(panelTrigger).toBeFocused();
        await expect(tooltip).toBeVisible();
    });

    test('panel tooltip returns on fresh pointer entry after popover closes', async ({ page }) => {
        const panelTrigger = page.getByRole('button', { name: 'View and panel controls' });
        const panelDialog = page.getByRole('dialog', { name: 'View and panel controls' });
        const tooltip = page.getByRole('tooltip').filter({ hasText: 'View and panel controls' });

        await panelTrigger.click();
        await expect(panelDialog).toBeVisible();
        await panelDialog.getByRole('button', { name: 'Track list' }).click();
        await page.keyboard.press('Escape');
        await expect(panelDialog).toHaveCount(0);
        await expect(panelTrigger).toBeFocused();
        await expect(tooltip).toHaveCount(0);

        await page.mouse.move(0, 0);
        await panelTrigger.hover();
        await expect(tooltip).toBeVisible();
    });
});
