import { type Page } from '@playwright/test';

import { chooseProjectDirectory } from './chosenProjectDirectory';
import { expect, test } from './e2eTest';
import { add_midi_track, launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const STEP_TIMEOUT = 30_000;

test.use({ actionTimeout: STEP_TIMEOUT, navigationTimeout: STEP_TIMEOUT });

async function palette(page: Page, name: string): Promise<void> {
    await page.keyboard.press(`${MOD}+K`);
    const input = page.getByTestId('command-palette-input');
    await input.fill(name);
    const option = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
    await expect(option).toBeVisible();
    await option.click();
    await expect(input).toHaveCount(0);
}

async function readOpenProject(page: Page): Promise<{ projectId: string; name: string }> {
    return page.evaluate(async () => {
        const { projectStore } = await import('/src/modules/Project/stores/index.ts');
        const project = projectStore.value;
        if (!project?.projectId || project.loading || !project.initialized) {
            throw new Error('Expected a settled open project');
        }
        return { projectId: project.projectId, name: project.name };
    });
}

async function waitForSavedWorkingView(page: Page, projectId: string): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate((id) => {
                const raw = localStorage.getItem(`sourdaw:project-view:${id}`);
                if (!raw) {
                    return null;
                }
                const view = JSON.parse(raw) as {
                    timeline?: { scrollX?: number; pixelsPerBeat?: number };
                    workspace?: { sidebarWidth?: number; virtualKeyboardOpen?: boolean };
                };
                return {
                    scrollX: view.timeline?.scrollX,
                    pixelsPerBeat: view.timeline?.pixelsPerBeat,
                    sidebarWidth: view.workspace?.sidebarWidth,
                    virtualKeyboardOpen: view.workspace?.virtualKeyboardOpen,
                };
            }, projectId)
        )
        .toEqual({ scrollX: 240, pixelsPerBeat: 20, sidebarWidth: 264, virtualKeyboardOpen: true });
}

async function reloadSavedProject(page: Page, expected: { projectId: string; name: string }): Promise<void> {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const mode = () =>
        page.evaluate(async (projectId) => {
            const { projectStore } = await import('/src/modules/Project/stores/index.ts');
            const project = projectStore.value;
            if (!project || project.loading) {
                return 'pending';
            }
            if (project.initialized) {
                return project.projectId === projectId ? 'saved-active' : 'wrong-active';
            }
            return 'launch-ready';
        }, expected.projectId);

    await expect.poll(mode, { timeout: STEP_TIMEOUT }).toMatch(/^(saved-active|launch-ready)$/);
    if ((await mode()) === 'launch-ready') {
        await page.getByRole('button', { name: `Open recent project ${expected.name}`, exact: true }).click();
    }
    await expect.poll(mode, { timeout: STEP_TIMEOUT }).toBe('saved-active');
    await wait_for_workspace_ready(page);
}

test('reopens the project timeline and working panels without restoring transient dialogs', async ({ page }) => {
    test.setTimeout(120_000);
    await setupWorkspace(page, { clearLocalStorage: false });
    await launch_new_project(page);
    await add_midi_track(page);
    await chooseProjectDirectory(page);

    const sidebar = page.getByRole('separator', { name: 'Resize sidebar' });
    await sidebar.focus();
    for (let step = 0; step < 4; step += 1) {
        await page.keyboard.press('ArrowRight');
    }
    await expect(sidebar).toHaveAttribute('aria-valuenow', '264');

    await palette(page, 'Zoom In');
    await palette(page, 'Zoom In');
    const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
    await minimap.focus();
    for (let step = 0; step < 3; step += 1) {
        await page.keyboard.press('ArrowRight');
    }
    await expect(minimap).toHaveAttribute('aria-valuenow', '12');

    await page.getByRole('button', { name: 'Toggle virtual keyboard' }).click();
    await expect(page.getByRole('region', { name: /Virtual Piano Keyboard/i })).toBeVisible();

    await palette(page, 'Save Project');
    await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: STEP_TIMEOUT });
    const project = await readOpenProject(page);
    await waitForSavedWorkingView(page, project.projectId);

    await page.keyboard.press(`${MOD}+K`);
    await expect(page.getByTestId('command-palette-input')).toBeVisible();
    await reloadSavedProject(page, project);

    await expect(page.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '264');
    await expect(page.getByRole('slider', { name: /^Timeline minimap/ })).toHaveAttribute('aria-valuenow', '12');
    await expect(page.getByRole('region', { name: /Virtual Piano Keyboard/i })).toBeVisible();
    await expect(page.getByTestId('command-palette-input')).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const { timelineViewStore } = await import('/src/modules/Arrangement/stores/index.ts');
                const view = timelineViewStore.value;
                return view ? { scrollX: view.scrollX, pixelsPerBeat: view.pixelsPerBeat } : null;
            })
        )
        .toEqual({ scrollX: 240, pixelsPerBeat: 20 });
});
