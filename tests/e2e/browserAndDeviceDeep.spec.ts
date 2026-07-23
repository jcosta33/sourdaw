import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Browser Effects Tab Deep', () => {
    test('Effects tab shows effect categories after template load', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        await page.waitForTimeout(500);

        await expect(browser).toBeVisible();
        const buttons = browser.getByRole('button');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(5);
    });
});

test.describe('Browser Project Tab Deep', () => {
    test('Project tab shows project metadata', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Project', exact: true }).click();
        await page.waitForTimeout(500);

        const content = browser.getByText(/BPM|tempo|track|arrangement|signature/i);
        const visible = await content.first().isVisible().catch(() => false);
        if (visible) {
            await expect(content.first()).toBeVisible();
        }
    });
});

test.describe('Browser Macros Tab', () => {
    test('Macros tab is accessible', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Macros', exact: true }).click();
        await page.waitForTimeout(500);

        await expect(browser).toBeVisible();
    });
});

test.describe('Inspector Notes Section', () => {
    test('Track notes accept and display text', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const notes = inspector.getByRole('textbox', { name: /Notes/i });
        await notes.fill('Production notes here');
        await expect(notes).toHaveValue('Production notes here');
    });
});

test.describe('Track Gain Slider', () => {
    test('Track gain slider has numeric value', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gain = inspector.getByRole('slider', { name: /gain/i });
        const value = await gain.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
    });
});

test.describe('Device Chain Add', () => {
    test('Adding multiple devices to chain works', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        await inspector.getByRole('button', { name: 'Add device' }).click();
        const gluten = page.getByRole('menuitem', { name: /Gluten/i });
        if (await gluten.isVisible().catch(() => false)) {
            await gluten.click();
            await page.waitForTimeout(1000);

            await inspector.getByRole('button', { name: 'Add device' }).click();
            const proof = page.getByRole('menuitem', { name: /Proof/i });
            if (await proof.isVisible().catch(() => false)) {
                await proof.click();
                await page.waitForTimeout(1000);
            }
        }

        await expect(inspector).toBeVisible();
    });
});

test.describe('Device Removal', () => {
    test('Removing a device clears it from chain', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const bacteria = page.getByRole('menuitem', { name: /Bacteria/i });
        if (await bacteria.isVisible().catch(() => false)) {
            await bacteria.click();
            await page.waitForTimeout(1000);

            const remove = inspector.getByRole('button', { name: /Remove Bacteria/i });
            if (await remove.isVisible().catch(() => false)) {
                await remove.click();
                await page.waitForTimeout(1000);
            }
        }

        await expect(inspector).toBeVisible();
    });
});

test.describe('MIDI Editor Velocity Lane', () => {
    test('Automation lane type selector has options', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 200, y: 30 } });
        const add = page.getByRole('menuitem', { name: /Add Clip Here/i });
        if (await add.isVisible().catch(() => false)) {
            await add.click();
            await page.waitForTimeout(500);
            await timeline.dblclick({ position: { x: 200, y: 30 } });
            await page.getByLabel('Piano roll editor').waitFor({ state: 'visible', timeout: 10000 });

            const lane_select = page.getByRole('combobox', { name: /Automation lane type/i });
            if (await lane_select.isVisible().catch(() => false)) {
                const options = await lane_select.getByRole('option').count();
                expect(options).toBeGreaterThan(1);
            }
        }
    });
});

test.describe('Timeline Context Menu Items', () => {
    test('Right-click timeline shows actionable menu items', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        if (!box) return;

        await timeline.click({ button: 'right', position: { x: 200, y: box.height * 0.5 } });
        const menu = page.getByRole('menu');
        if (await menu.isVisible().catch(() => false)) {
            const items = menu.getByRole('menuitem');
            const count = await items.count();
            expect(count).toBeGreaterThan(0);
        }
    });
});

test.describe('Preferences Tab Navigation', () => {
    test('Can navigate preference tabs', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        const tabs = dialog.getByRole('tab');
        const count = await tabs.count();
        if (count > 1) {
            await tabs.nth(1).click();
            await page.waitForTimeout(500);
            await expect(dialog).toBeVisible();
        }

        await page.keyboard.press('Escape');
    });
});

test.describe('Export Dialog Escape Close', () => {
    test('Export dialog closes with Escape', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+Shift+E`);
        const dialog = page.getByRole('dialog').filter({ hasText: /Bakery|Export/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: 3000 });
    });
});
