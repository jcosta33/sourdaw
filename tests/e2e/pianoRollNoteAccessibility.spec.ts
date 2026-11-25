import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test('piano-roll notes can be selected and edited from the keyboard', async ({ page }) => {
    await setupWorkspace(page);
    await launch_new_project(page);

    await page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' }).click();
    const timeline = page.getByLabel('Timeline editor surface');
    const clipPosition = { x: 200, y: 30 };
    await timeline.click({ button: 'right', position: clipPosition });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await timeline.dblclick({ position: clipPosition });

    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();
    const drawOrigin = await pianoRoll.evaluate((canvas) => {
        const viewport = canvas.parentElement?.parentElement;
        if (!viewport) {
            throw new Error('Piano roll scroll viewport is missing');
        }
        return { x: canvas.getBoundingClientRect().left, y: viewport.getBoundingClientRect().top };
    });
    await page.mouse.click(drawOrigin.x + 40, drawOrigin.y + 42);
    await page.mouse.click(drawOrigin.x + 80, drawOrigin.y + 58);
    await expect(page.getByLabel(/^2 notes in /)).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Note navigator' });
    const listbox = page.getByRole('listbox', { name: 'Piano roll notes' });
    await expect(listbox).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(listbox).toBeFocused();
    const first = listbox.getByRole('option', { name: /starts at clip beat 1,/ });
    const second = listbox.getByRole('option', { name: /starts at clip beat 2,/ });
    const status = page.getByRole('dialog', { name: 'Note navigator' }).getByRole('status');
    await expect(first).toHaveAttribute('aria-posinset', '1');
    await expect(second).toHaveAttribute('aria-posinset', '2');
    await expect(second).toHaveAttribute('aria-setsize', '2');
    await expect(listbox.getByRole('option', { selected: true })).toHaveCount(0);
    await expect(status).toHaveText('No notes selected');

    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(status).toHaveText(/^Selected .+, starts at clip beat 1,/);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    await page.keyboard.press('End');
    await expect(second).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Space');
    await expect(listbox.getByRole('option', { selected: true })).toHaveCount(2);
    await expect(status).toHaveText('2 notes selected');
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('aria-selected', 'false');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(page.getByLabel(/^2 notes in /)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(listbox).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(listbox).toHaveCount(0);
    await expect(pianoRoll).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(page.getByLabel(/^1 note in /)).toBeVisible();
    await expect(trigger).toBeVisible();

    await trigger.click();
    await expect(listbox).toBeFocused();
    await expect(first).toBeVisible();
    await expect(second).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(pianoRoll).toBeFocused();
    await expect(listbox).toHaveCount(0);
});
