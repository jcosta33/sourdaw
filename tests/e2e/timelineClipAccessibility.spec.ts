import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test('timeline clips are browsable and selectable without triggering background shortcuts', async ({ page }) => {
    await setupWorkspace(page);
    await launch_new_project(page);

    const addMidiTrack = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await expect(addMidiTrack).toBeVisible();
    await addMidiTrack.click();

    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 200, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();

    const browse = page.getByRole('button', { name: 'Browse timeline clips' });
    await expect(browse).toBeVisible();
    await browse.click();

    const listbox = page.getByRole('listbox', { name: 'Timeline clips' });
    await expect(listbox).toBeFocused();
    const option = listbox.getByRole('option', { name: /New midi clip/i });
    await expect(option).toHaveAttribute('aria-posinset', '1');
    await expect(option).toHaveAttribute('aria-setsize', '1');
    await expect(option).toHaveAttribute('aria-selected', 'false');

    await listbox.press('Space');
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('status').filter({ hasText: /Selected New midi clip/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    await listbox.press('Delete');
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('aria-selected', 'true');

    await listbox.press('Escape');
    await expect(listbox).not.toBeVisible();
    await expect(browse).toBeFocused();

    await canvas.focus();
    await canvas.press('Space');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

for (const width of [1440, 1024]) {
    test(`Browse stays outside the canvas and available with the track list hidden at width ${width}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);
        const addMidiTrack = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await expect(addMidiTrack).toBeVisible();
        await addMidiTrack.click();

        const canvas = page.getByLabel('Timeline editor surface');
        const browse = page.getByRole('button', { name: 'Browse timeline clips' });
        await expect(canvas).toBeVisible();
        await expect(browse).toBeVisible();
        await expect(
            page
                .getByRole('toolbar', { name: 'Transport controls' })
                .getByRole('button', { name: 'Browse timeline clips' })
        ).toBeVisible();
        await expect(browse).toHaveCount(1);
        const canvasBox = await canvas.boundingBox();
        const browseBox = await browse.boundingBox();
        if (canvasBox === null || browseBox === null) {
            throw new Error('Required canvas or Browse control has no rendered bounds');
        }
        const intersects =
            browseBox.x < canvasBox.x + canvasBox.width &&
            browseBox.x + browseBox.width > canvasBox.x &&
            browseBox.y < canvasBox.y + canvasBox.height &&
            browseBox.y + browseBox.height > canvasBox.y;
        expect(intersects).toBe(false);

        for (const position of [
            { x: 30, y: 20 },
            { x: 80, y: 30 },
        ]) {
            expect(
                await canvas.evaluate((element, point) => {
                    const rect = element.getBoundingClientRect();
                    return document.elementFromPoint(rect.left + point.x, rect.top + point.y) === element;
                }, position)
            ).toBe(true);
            await canvas.click({ position });
            await canvas.click({ button: 'right', position });
            await expect(page.getByRole('menuitem', { name: /Add Clip Here/i })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('menuitem', { name: /Add Clip Here/i })).not.toBeVisible();
        }

        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        if (width === 1024) {
            await page.getByRole('button', { name: 'View and panel controls' }).click();
            await page.getByRole('button', { name: 'Track list', exact: true }).click();
            await page.keyboard.press('Escape');
        } else {
            await page.getByRole('button', { name: 'Toggle track list', exact: true }).click();
        }
        await expect(page.getByRole('grid', { name: 'Track list' })).not.toBeVisible();
        await expect(browse).toBeVisible();

        if (width === 1024) {
            await page.getByRole('button', { name: 'More transport controls' }).click();
            await expect(page.getByRole('dialog', { name: 'More transport controls' })).toBeVisible();
        }
        await browse.focus();
        await browse.press('Enter');
        const listbox = page.getByRole('listbox', { name: 'Timeline clips' });
        await expect(listbox).toBeFocused();
        await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
        const option = listbox.getByRole('option', { name: /New midi clip/i });
        await expect(option).toHaveAttribute('aria-setsize', '1');
        await expect(option).toHaveAttribute('aria-selected', 'false');
        if (width === 1024) {
            await expect(page.getByRole('dialog', { name: 'More transport controls' })).not.toBeVisible();
        }
        await listbox.press('Space');
        await expect(option).toHaveAttribute('aria-selected', 'true');
        await listbox.press('Escape');
        await expect(listbox).not.toBeVisible();
        await expect(browse).toBeFocused();
    });
}
