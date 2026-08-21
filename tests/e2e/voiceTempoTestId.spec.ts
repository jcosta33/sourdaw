import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Transport tempo and time signature', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Tempo BPM steps from 120 to 121 on ArrowUp', async ({ page }) => {
        const bpm = page.getByRole('spinbutton', { name: 'Tempo BPM', exact: true });
        await expect(bpm).toHaveAttribute('aria-valuenow', '120');
        await bpm.focus();
        await page.keyboard.press('ArrowUp');
        await expect(bpm).toHaveAttribute('aria-valuenow', '121');
    });

    test('time signature edits from 4/4 to 3/4', async ({ page }) => {
        const display = page.getByRole('button', { name: 'Time signature: 4/4. Click to edit.', exact: true });
        await expect(display).toBeVisible();
        await display.click();

        const numerator = page.getByRole('spinbutton', { name: 'Time signature numerator', exact: true });
        await expect(numerator).toBeVisible();
        await numerator.fill('3');
        await numerator.press('Enter');

        await expect(
            page.getByRole('button', { name: 'Time signature: 3/4. Click to edit.', exact: true })
        ).toBeVisible();
        await expect(display).toHaveCount(0);
    });

    test('tempo map adds a 140 BPM change at beat 0 and closes', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle tempo map', exact: true });
        const editor = page.getByRole('dialog', { name: 'Tempo map editor', exact: true });

        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(editor).toHaveCount(0);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(editor).toBeVisible();
        await expect(editor.getByText('No tempo changes', { exact: true })).toBeVisible();

        await page.getByRole('spinbutton', { name: 'New tempo change BPM', exact: true }).fill('140');
        await page.getByRole('button', { name: 'Add tempo change', exact: true }).click();

        await expect(editor.getByText('No tempo changes', { exact: true })).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: '140 BPM at beat 0. Click to edit.', exact: true })
        ).toBeVisible();

        await page.locator('#main-content').click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(editor).toHaveCount(0);
    });
});
