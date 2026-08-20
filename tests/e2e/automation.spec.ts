import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
}

test.describe('Automation Lanes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('Can toggle automation lanes and switch parameters', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await expect(page.getByText(/New midi clip/i).first()).toBeVisible();

        await canvas.dblclick({ position: { x: 300, y: 30 } });
        await expect(page.getByLabel('Piano roll editor')).toBeVisible();

        const laneSelector = page.getByRole('combobox', { name: /Automation lane type/i });
        await expect(laneSelector).toHaveValue('velocity');

        // MPE per-note lanes stay hidden until the engine sounds them (#719).
        await laneSelector.selectOption('cc11');
        await expect(laneSelector).toHaveValue('cc11');

        const ccLane = page.getByRole('group', { name: 'CC 11 automation lane' });
        await expect(ccLane).toBeVisible();
        await expect(ccLane.getByText('Click to add CC points')).toBeVisible();

        await ccLane.click({ position: { x: 50, y: 20 } });
        const point = ccLane.getByTitle(/^Beat /);
        await expect(point).toHaveCount(1);
        const titleBefore = await point.getAttribute('title');
        expect(titleBefore).not.toBeNull();

        const box = await point.boundingBox();
        if (box === null) {
            throw new Error('CC point has no bounding box');
        }
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 - 16, { steps: 5 });
        await page.mouse.up();
        await expect(point).not.toHaveAttribute('title', titleBefore ?? '');
    });
});
