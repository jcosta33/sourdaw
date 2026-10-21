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
