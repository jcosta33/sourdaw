import { type Locator } from '@playwright/test';

import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

function measureActiveOption(listbox: Locator) {
    return listbox.evaluate((viewport) => {
        const activeId = viewport.getAttribute('aria-activedescendant');
        const active = activeId ? document.getElementById(activeId) : null;
        if (!active || !viewport.contains(active)) {
            throw new Error('The active piano-roll note is missing from its listbox');
        }

        const top = viewport.getBoundingClientRect().top + viewport.clientTop;
        const height = viewport.clientHeight;
        const option = active.getBoundingClientRect();
        return { height, clippedPixels: Math.max(top - option.top, option.bottom - (top + height), 0) };
    });
}

test('piano-roll notes keep the active option in view when the list viewport shrinks', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await setupWorkspace(page);
    await launch_new_project(page);

    await page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' }).click();
    const timeline = page.getByLabel('Timeline editor surface');
    const position = { x: 200, y: 30 };
    await timeline.click({ button: 'right', position });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await timeline.dblclick({ position });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();

    await page.evaluate(async () => {
        const { clipSelectionStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { executeUserAppAction } = await import('/src/modules/Command/useCases/index.ts');
        const clipId = clipSelectionStore.value?.selectedClipId;
        if (!clipId) {
            throw new Error('The MIDI clip was not selected');
        }
        await executeUserAppAction({
            type: 'addNotes',
            payload: {
                clipId,
                notes: Array.from({ length: 16 }, (_, index) => ({
                    pitch: 57 + index,
                    startBeat: index / 4,
                    duration: 0.125,
                    velocity: 95,
                })),
            },
        });
    });
    await expect(page.getByLabel(/^16 notes in /)).toBeVisible();

    await page.getByRole('button', { name: 'Note navigator' }).press('Enter');
    const listbox = page.getByRole('listbox', { name: 'Piano roll notes' });
    await expect(listbox).toBeFocused();
    await page.keyboard.press('End');
    const last = listbox.getByRole('option', { name: /starts at clip beat 3\.75,/ });
    await expect(last).toHaveAttribute('aria-posinset', '16');
    await expect(last).toHaveAttribute('aria-setsize', '16');
    const lastId = await last.getAttribute('id');
    if (!lastId) {
        throw new Error('The last piano-roll note has no option ID');
    }
    await expect(listbox).toHaveAttribute('aria-activedescendant', lastId);
    await expect.poll(async () => (await measureActiveOption(listbox)).clippedPixels).toBeLessThanOrEqual(1);

    const initial = await measureActiveOption(listbox);
    await page.setViewportSize({ width: 980, height: 580 });
    await expect.poll(async () => (await measureActiveOption(listbox)).height).toBeLessThan(initial.height);
    await expect(listbox).toBeFocused();
    await expect(listbox).toHaveAttribute('aria-activedescendant', lastId);
    await expect.poll(async () => (await measureActiveOption(listbox)).clippedPixels).toBeLessThanOrEqual(1);

    await listbox.hover();
    await page.mouse.wheel(0, -64);
    await expect.poll(async () => (await measureActiveOption(listbox)).clippedPixels).toBeGreaterThan(1);
    await expect(listbox).toHaveAttribute('aria-activedescendant', lastId);
});
