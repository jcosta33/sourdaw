import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Launch Screen & Project Entry', () => {
    test.describe('Launch screen', () => {
        test.beforeEach(async ({ page }) => {
            await setupWorkspace(page);
        });

        test('Can browse the template grid and filter by category', async ({ page }) => {
            const launch_screen = page.getByLabel('Sourdaw — start a project');
            await launch_screen.waitFor({ state: 'visible' });

            await page.locator('#launch-from-template').click();

            await expect(page.getByText('Start a new project')).toBeVisible();
            await expect(page.getByRole('button', { name: 'EDM' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Cinematic' })).toBeVisible();

            await page.getByRole('button', { name: 'Film', exact: true }).click();

            await expect(page.getByRole('button', { name: 'Cinematic' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'EDM' })).toBeHidden();
        });

        test('Can load a template from the grid and enter the workspace', async ({ page }) => {
            test.setTimeout(60000);
            const launch_screen = page.getByLabel('Sourdaw — start a project');
            await launch_screen.waitFor({ state: 'visible' });

            await page.locator('#launch-from-template').click();
            await expect(page.getByText('Start a new project')).toBeVisible();

            await page.getByRole('button', { name: 'Lo-fi' }).click();
            await wait_for_workspace_ready(page);

            const track_list = page.getByRole('grid', { name: /Track list/i });
            await expect(track_list).toBeVisible();
            await expect(track_list.getByRole('row').first()).toBeVisible();
        });

        test('Can browse demos and load Nebula Drift', async ({ page }) => {
            test.setTimeout(60000);
            const launch_screen = page.getByLabel('Sourdaw — start a project');
            await launch_screen.waitFor({ state: 'visible' });

            await page.locator('#launch-demo-project').click();
            await expect(page.getByText('Start a new project')).toBeVisible();
            await expect(page.getByRole('button', { name: /Nebula Drift/i })).toBeVisible();

            await page.getByRole('button', { name: /Nebula Drift/i }).click();
            await wait_for_workspace_ready(page);

            await expect(page.getByRole('grid', { name: /Track list/i }).getByRole('row').first()).toBeVisible();
        });

        test('Can load Mycelium Ascendant and enter its arranged workspace', async ({ page }) => {
            test.setTimeout(120_000);
            const launch_screen = page.getByLabel('Sourdaw — start a project');
            await launch_screen.waitFor({ state: 'visible' });

            await page.locator('#launch-demo-project').click();
            const mycelium_card = page.getByRole('button', { name: /Mycelium Ascendant/i });
            await expect(mycelium_card).toContainText('Four minutes of psychedelic trance');
            await mycelium_card.click();
            await wait_for_workspace_ready(page);

            await expect(page.getByRole('button', { name: /^Mycelium Ascendant/ })).toBeVisible();
            const track_list = page.getByRole('grid', { name: /Track list/i });
            await expect(track_list.getByRole('row').filter({ hasText: 'Kick' }).first()).toBeVisible();
            await expect(track_list.getByRole('row').filter({ hasText: 'Main Vision' }).first()).toBeVisible();
            await expect(track_list.getByRole('row').filter({ hasText: 'Temple Chamber' }).first()).toBeVisible();
            await expect(page.getByRole('region', { name: 'Arrangement sections' })).toContainText('Sporefall');
        });

        test('Can navigate back from grid view to home', async ({ page }) => {
            const launch_screen = page.getByLabel('Sourdaw — start a project');
            await launch_screen.waitFor({ state: 'visible' });

            await page.locator('#launch-from-template').click();
            await expect(page.getByText('Start a new project')).toBeVisible();

            await page.getByRole('button', { name: 'Back to home' }).click();
            await expect(page.locator('#launch-new-project')).toBeVisible();
        });
    });

    test.describe('Project menu', () => {
        test.beforeEach(async ({ page }) => {
            await setupWorkspace(page);
            await launch_new_project(page);
        });

        test('Can open the project menu and see all items', async ({ page }) => {
            await page.getByRole('button', { name: 'Project menu' }).click();
            const menu = page.getByRole('menu', { name: 'Project menu' });
            await expect(menu).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'New Project' })).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'New from Template…' })).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'Load Demo Project…' })).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'Save' })).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'Export Audio…' })).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'Export Project File…' })).toBeVisible();
            await expect(menu.getByRole('menuitem', { name: 'Import Project File…' })).toBeVisible();
        });

        test('Can close the project menu with Escape', async ({ page }) => {
            await page.getByRole('button', { name: 'Project menu' }).click();
            const menu = page.getByRole('menu', { name: 'Project menu' });
            await expect(menu).toBeVisible();

            await page.keyboard.press('Escape');

            await expect(menu).toBeHidden();
        });

        test('Can open template chooser from the project menu', async ({ page }) => {
            await page.getByRole('button', { name: 'Project menu' }).click();
            const menu = page.getByRole('menu', { name: 'Project menu' });
            await menu.getByRole('menuitem', { name: 'New from Template…' }).click();

            await expect(page.getByText('Start a new project')).toBeVisible();
            await expect(page.getByRole('button', { name: 'EDM' })).toBeVisible();
        });
    });

    test.describe('Project persistence', () => {
        test.beforeEach(async ({ page }) => {
            await setupWorkspace(page);
            await launch_new_project(page);
        });

        test('Saving the project clears the unsaved changes indicator', async ({ page }) => {
            await page.keyboard.press(`${MOD}+k`);
            await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
            await page.getByRole('option', { name: 'Add MIDI Track' }).click();

            await expect(page.locator('[title="Unsaved changes"]')).toBeVisible({ timeout: 10000 });

            await page.keyboard.press(`${MOD}+s`);

            await expect(page.locator('[title="Unsaved changes"]')).toBeHidden({ timeout: 10000 });
        });

        test('Can rename the project from the transport bar', async ({ page }) => {
            const project_button = page.getByRole('button', { name: 'Untitled Project' });
            await project_button.click();

            const input = page.locator('input:focus');
            await input.fill('My Test Song');
            await input.press('Enter');

            await expect(page.getByRole('button', { name: 'My Test Song' })).toBeVisible();
        });
    });
});
