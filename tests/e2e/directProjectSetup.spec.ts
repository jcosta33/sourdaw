import { expect, test } from './e2eTest';
import { LAUNCH_SCREEN_NAME, launch_new_project, setupWorkspace } from './e2eUtils';

const DIRECT_SETUP_ENTRY_PATH = '/e2e/direct-project-setup.js';

test.describe('Direct project setup', () => {
    test('direct entry exports newProject and resolves at the deterministic path', async ({ page }) => {
        await setupWorkspace(page);
        const hasNewProject = await page.evaluate(async (entryPath) => {
            const mod: { newProject?: unknown } = await import(entryPath);
            return typeof mod.newProject === 'function';
        }, DIRECT_SETUP_ENTRY_PATH);
        expect(hasNewProject).toBe(true);
    });

    test('creates a blank project without any launch-screen interaction', async ({ page }) => {
        await setupWorkspace(page);
        // Hide the launch-screen button so a UI-click implementation cannot fall
        // back to it; the direct module route must succeed despite its absence.
        await page.addStyleTag({ content: '#launch-new-project { display: none !important; }' });

        await launch_new_project(page);

        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();

        // Verify the project is a live editable document by renaming it.
        await page.getByRole('button', { name: 'Untitled Project' }).click();
        const input = page.locator('input:focus');
        await input.fill('Direct Setup Test');
        await input.press('Enter');
        await expect(page.getByRole('button', { name: 'Direct Setup Test' })).toBeVisible();
    });
});
