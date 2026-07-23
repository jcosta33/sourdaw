import { expect, test } from '@playwright/test';
import { launch_from_template, setupWorkspace } from './e2eUtils';

// ---------------------------------------------------------------------------
// Audio clip operations — EDM template tracks + inspector selection.
// ---------------------------------------------------------------------------

test.describe('Audio clip operations', () => {
    test('EDM template loads multiple tracks', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        expect(await track_list.getByRole('row').count()).toBeGreaterThanOrEqual(2);
    });

    test('Selecting a track shows it in the inspector', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('row').first().click();
        await page.waitForTimeout(500);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Plugin browser — Add device menu lists available devices.
// ---------------------------------------------------------------------------

test.describe('Plugin browser and scan', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Add device menu lists the built-in effects', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('row').first().click();
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.waitForTimeout(500);

        const names = (await page.getByRole('menuitem').allInnerTexts()).join(' | ');
        expect(names).toMatch(/Gluten/);
        expect(names).toMatch(/Bacteria/);
    });
});

// ---------------------------------------------------------------------------
// Fermenter panel — Macro combobox accessible after opening via Browser.
// ---------------------------------------------------------------------------

test.describe('Fermenter panel controls', () => {
    test('Fermenter card opens the panel with the Macro combobox', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
        await browser.getByText('Fermenter', { exact: true }).click();
        await page.waitForTimeout(1000);

        await expect(page.getByRole('combobox', { name: 'Macro' })).toBeVisible();
    });
});
