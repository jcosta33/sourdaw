import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
}

async function openPianoRollOnNewClip(page: Page): Promise<void> {
    await addMidiTrack(page);
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
}

test.describe('Expression lanes on a new MIDI clip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120_000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await openPianoRollOnNewClip(page);
    });

    test('expression view reveals the velocity selector and removes it when closed', async ({ page }) => {
        const expression = page.getByRole('button', { name: /Toggle Expression View/i });
        const lane = page.getByRole('combobox', { name: 'Active expression lane', exact: true });

        await expect(expression).toHaveAttribute('aria-pressed', 'false');
        await expect(lane).toHaveCount(0);

        await expression.click();
        await expect(expression).toHaveAttribute('aria-pressed', 'true');
        await expect(lane).toBeVisible();
        await expect(lane).toHaveValue('velocity');
        await expect(lane.getByRole('option', { name: 'Velocity', exact: true })).toHaveCount(1);

        await expression.click();
        await expect(expression).toHaveAttribute('aria-pressed', 'false');
        await expect(lane).toHaveCount(0);
    });

    test('changing the scale root updates folded keyboard rows while expression remains available', async ({
        page,
    }) => {
        const expression = page.getByRole('button', { name: /Toggle Expression View/i });
        const lane = page.getByRole('combobox', { name: 'Active expression lane', exact: true });
        const root = page.getByRole('combobox', { name: 'Scale root note', exact: true });
        const scaleType = page.getByRole('combobox', { name: 'Scale type', exact: true });
        const fold = page.getByRole('button', { name: 'Toggle fold to scale' });

        await expression.click();
        await expect(lane).toHaveValue('velocity');
        await expect(root).toHaveValue('0');
        await scaleType.selectOption('major');
        await expect(scaleType).toHaveValue('major');
        await fold.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('C#4', { exact: true })).toHaveCount(0);

        await root.selectOption({ label: 'D' });
        await expect(root).toHaveValue('2');
        await expect(page.getByText('C#4', { exact: true })).toBeVisible();
        await expect(lane).toBeVisible();
        await expect(lane).toHaveValue('velocity');
    });

    test('fold, constrain, and expression view are simultaneously active', async ({ page }) => {
        const fold = page.getByRole('button', { name: 'Toggle fold to scale' });
        const constrain = page.getByRole('button', { name: 'Constrain notes to scale' });
        const expression = page.getByRole('button', { name: /Toggle Expression View/i });
        const lane = page.getByRole('combobox', { name: 'Active expression lane', exact: true });

        await fold.click();
        await constrain.click();
        await expression.click();

        await expect(fold).toHaveAttribute('aria-pressed', 'true');
        await expect(constrain).toHaveAttribute('aria-pressed', 'true');
        await expect(expression).toHaveAttribute('aria-pressed', 'true');
        await expect(lane).toBeVisible();
        await expect(lane).toHaveValue('velocity');
    });
});
