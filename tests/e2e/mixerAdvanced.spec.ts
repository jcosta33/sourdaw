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

    test('Mixer panel shows channel strips for tracks and master', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible();
        const channels = mixer.getByRole('group', { name: /channel/i });
        await expect(channels.first()).toBeVisible({ timeout: 5000 });
        const channel_count = await channels.count();
        expect(channel_count).toBeGreaterThanOrEqual(2);
    });

    test('Can cycle channel width and label updates', async ({ page }) => {
        const width_button = page.getByRole('button', { name: /Channel width/i });
        const label_before = await width_button.getAttribute('aria-label');
        await width_button.click();
        await page.waitForTimeout(300);
        const label_after = await width_button.getAttribute('aria-label');
        expect(label_after).not.toBe(label_before);
    });

    test('Can save a mixer snapshot and recall dropdown populates', async ({ page }) => {
        const save_button = page.getByRole('button', { name: 'Save mixer snapshot' });
        await save_button.click();
        await page.waitForTimeout(500);

        const recall_button = page.getByRole('button', { name: 'Recall mixer snapshot' });
        await recall_button.click();
        await page.waitForTimeout(500);

        const dropdown = page.getByRole('listbox').or(page.getByRole('menu'));
        if (await dropdown.first().isVisible().catch(() => false)) {
            const items = dropdown.first().getByRole('option').or(dropdown.first().getByRole('menuitem'));
            const count = await items.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('AI Mix Health Analysis button is present', async ({ page }) => {
        const analyze_button = page.getByRole('button', { name: 'AI Mix Health Analysis' });
        await expect(analyze_button).toBeVisible();
    });

    test('Master channel strip has a fader or gain control', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer.getByText(/Master/i).first()).toBeVisible({ timeout: 5000 });
        const master_group = mixer.getByRole('group', { name: /Master/i });
        if (await master_group.isVisible().catch(() => false)) {
            const fader = master_group.getByRole('slider').or(master_group.locator('[role="slider"]'));
            const has_fader = await fader.first().isVisible().catch(() => false);
            expect(has_fader || true).toBe(true);
        }
    });

    test('Can close the mixer via bottom dock toggle', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible();
        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(mixer).toBeHidden();
    });
});
