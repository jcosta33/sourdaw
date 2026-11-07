import { expect, test } from './e2eTest';
import { LAUNCH_SCREEN_NAME, setupWorkspace } from './e2eUtils';

const DIRECT_SETUP_ENTRY_PATH = '/e2e/direct-project-setup.js';

test.describe('Direct project setup', () => {
    test('direct entry exports newProject and resolves at the deterministic path', async ({ page }) => {
        await setupWorkspace(page);
        // RED before the vite plugin serves this URL: the import throws a 404.
        const hasNewProject = await page.evaluate(async (entryPath) => {
            const mod: { newProject?: unknown } = await import(entryPath);
            return typeof mod.newProject === 'function';
        }, DIRECT_SETUP_ENTRY_PATH);
        expect(hasNewProject).toBe(true);
    });

    test('creates a blank project without any launch-screen interaction', async ({ page }) => {
        await setupWorkspace(page);
        const result = await page.evaluate(async (entryPath) => {
            const { newProject }: typeof import('./directProjectSetupEntry') = await import(entryPath);
            return newProject();
        }, DIRECT_SETUP_ENTRY_PATH);
        expect(result).toBe(true);
        await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();
    });
});
