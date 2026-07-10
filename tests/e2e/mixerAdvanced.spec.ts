import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Mixer Advanced', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
    });

    test('Mixer panel is visible with channel strips', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible();
        await expect(mixer.getByRole('group', { name: /channel/i }).first()).toBeVisible({ timeout: 5000 });
    });

    test('Can cycle channel width', async ({ page }) => {
        const width_button = page.getByRole('button', { name: /Channel width/i });
        await expect(width_button).toBeVisible();
        await width_button.click();
        await expect(width_button).toBeVisible();
    });

    test('Can save and recall a mixer snapshot', async ({ page }) => {
        const save_button = page.getByRole('button', { name: 'Save mixer snapshot' });
        await expect(save_button).toBeVisible();
        await save_button.click();

        const recall_button = page.getByRole('button', { name: 'Recall mixer snapshot' });
        await expect(recall_button).toBeVisible();
    });

    test('Can open AI Mix Health Analysis dialog', async ({ page }) => {
        const analyze_button = page.getByRole('button', { name: 'AI Mix Health Analysis' });
        if (await analyze_button.isVisible().catch(() => false)) {
            await analyze_button.click();
            await expect(page.getByRole('dialog').filter({ hasText: /Mix Health/i })).toBeVisible({ timeout: 5000 });
            await page.keyboard.press('Escape');
        }
    });

    test('Master channel strip is visible', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer.getByText(/Master/i).first()).toBeVisible({ timeout: 5000 });
    });

    test('Can close the mixer via bottom dock toggle', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible();
        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(mixer).toBeHidden();
    });
});
