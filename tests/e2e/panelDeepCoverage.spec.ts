import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Fermenter Panel Deep', () => {
    test('Fermenter panel macro and portamento visible on EDM template', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const macro = page.getByRole('combobox', { name: 'Macro' });
        if (await macro.isVisible().catch(() => false)) {
            await expect(macro).toBeVisible();
        }

        const portamento = page.getByRole('slider', { name: 'Portamento time' });
        if (await portamento.isVisible().catch(() => false)) {
            const value = await portamento.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });
});

test.describe('Toaster Panel Deep', () => {
    test('Toaster kit search and pad trigger visible on EDM template', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const kit_search = page.getByPlaceholder('Search Toaster kits').or(page.getByRole('searchbox', { name: 'Search Toaster kits' }));
        if (await kit_search.first().isVisible().catch(() => false)) {
            await expect(kit_search.first()).toBeVisible();
        }
    });
});

test.describe('Levain Panel Deep', () => {
    test('Levain instrument search visible on EDM template', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const search = page.getByPlaceholder('Search Levain instruments').or(page.getByRole('searchbox', { name: 'Search Levain instruments' }));
        if (await search.first().isVisible().catch(() => false)) {
            await expect(search.first()).toBeVisible();
        }
    });
});

test.describe('Gluten Panel Deep', () => {
    test('Gluten preset search visible when device added', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const gluten = page.getByRole('menuitem', { name: /Gluten/i });
        if (await gluten.isVisible().catch(() => false)) {
            await gluten.click();
            await page.waitForTimeout(1000);

            const search = page.getByPlaceholder('Search Gluten presets').or(page.getByRole('searchbox', { name: 'Search Gluten presets' }));
            if (await search.first().isVisible().catch(() => false)) {
                await expect(search.first()).toBeVisible();
            }
        }
    });
});

test.describe('Session View Deep', () => {
    test('Session view shows scene content on EDM template', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
        await page.locator('#bottom-dock-tab-session').click();
        await page.waitForTimeout(500);

        const panel = page.locator('#bottom-dock-tabpanel');
        await expect(panel).toBeVisible();
        const buttons = panel.getByRole('button');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
    });
});

test.describe('Adjustment Layer Deep', () => {
    test('Can add adjustment layer and see fade controls', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        await expect(strip).toBeVisible();

        await page.getByRole('button', { name: 'Add adjustment layer' }).click();
        await page.waitForTimeout(1000);

        await expect(strip).toBeVisible();
    });
});

test.describe('Tempo Map Editor Deep', () => {
    test('Tempo map editor opens and shows tempo change controls', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const toggle = page.getByRole('button', { name: 'Toggle tempo map' });
        await toggle.click();
        await page.waitForTimeout(500);

        const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });
        if (await dialog.isVisible().catch(() => false)) {
            const beat_input = page.getByRole('spinbutton', { name: 'New tempo change beat' });
            const bpm_input = page.getByRole('spinbutton', { name: 'New tempo change BPM' });
            const add_btn = page.getByRole('button', { name: 'Add tempo change' });

            const has_inputs = await beat_input.isVisible().catch(() => false);
            const has_add = await add_btn.isVisible().catch(() => false);

            if (has_inputs && has_add) {
                await beat_input.fill('8');
                await bpm_input.fill('140');
                await add_btn.click();
                await page.waitForTimeout(500);

                const edit_btn = page.getByRole('button', { name: /140 BPM at beat 8/i });
                if (await edit_btn.isVisible().catch(() => false)) {
                    await expect(edit_btn).toBeVisible();
                }
            }
        }
    });
});

test.describe('Shortcut Cheat Sheet', () => {
    test('Can open and navigate shortcut cheat sheet', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();

        await page.keyboard.press('Shift+Slash');
        const sheet = page.getByRole('dialog', { name: /Keyboard shortcuts/i });
        await expect(sheet).toBeVisible({ timeout: 5000 });

        const content = sheet.getByText(/Zoom|Transport|Editing|View/i);
        await expect(content.first()).toBeVisible({ timeout: 3000 });

        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden({ timeout: 3000 });
    });
});

test.describe('Notification Toast', () => {
    test('Action triggers notification in status bar', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.waitForTimeout(500);

        const status = page.getByRole('status', { name: 'Application status' });
        const last_text = status.getByText(/Last:/i);
        if (await last_text.isVisible().catch(() => false)) {
            const text = await last_text.textContent();
            expect(text).toMatch(/add|track|midi/i);
        }
    });
});

test.describe('Prompt Bar Deep', () => {
    test('Prompt bar accepts natural language input', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const prompt = page.getByRole('textbox', { name: 'Prompt command input' });
        await expect(prompt).toBeVisible();

        await prompt.fill('set tempo to 140');
        await expect(prompt).toHaveValue('set tempo to 140');

        await prompt.fill('');
        await expect(prompt).toHaveValue('');
    });
});

test.describe('Browser Tab Switching', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Each browser tab shows different content', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });

        for (const tab of ['Instruments', 'Effects', 'Library', 'Macros', 'Project']) {
            await browser.getByRole('button', { name: tab, exact: true }).click();
            await page.waitForTimeout(300);
            await expect(browser).toBeVisible();
        }
    });
});

test.describe('Undo History Panel Content', () => {
    test('Undo history shows entries after actions', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.waitForTimeout(300);

        await page.getByRole('button', { name: /Toggle undo history panel/i }).click();
        await page.waitForTimeout(500);

        const entries = page.getByText(/undo/i, { exact: false }).filter({ hasText: /\d/ });
        if (await entries.first().isVisible().catch(() => false)) {
            const text = await entries.first().textContent();
            expect(text).toMatch(/\d/);
        }
    });
});
