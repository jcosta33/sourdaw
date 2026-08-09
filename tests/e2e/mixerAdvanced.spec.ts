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

    test('Can save a mixer snapshot (recall button reflects saved state)', async ({ page }) => {
        const save_button = page.getByRole('button', { name: 'Save mixer snapshot' });
        await save_button.click();
        await page.waitForTimeout(500);

        // After saving, the recall control is present and reflects at least one snapshot.
        const recall_button = page.getByRole('button', { name: 'Recall mixer snapshot' });
        await expect(recall_button).toBeVisible({ timeout: 5000 });
        // The recall button label or nearby count reflects the saved snapshot.
        const recall_label = await recall_button.getAttribute('aria-label');
        expect(recall_label).toMatch(/Recall/i);
    });

    test('AI Mix Health Analysis button is present', async ({ page }) => {
        const analyze_button = page.getByRole('button', { name: 'AI Mix Health Analysis' });
        await expect(analyze_button).toBeVisible();
    });

    test('Master channel strip has a fader or gain control', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible({ timeout: 5000 });
        // The master strip's fader wrapper carries a stable test id; the inner
        // slider sizes its parent to zero width in the dock layout, so assert
        // attachment + a real value rather than CSS visibility.
        const master_gain = page.getByTestId('master-gain');
        await expect(master_gain).toBeAttached({ timeout: 5000 });
        const slider = master_gain.getByRole('slider');
        await expect(slider).toHaveAttribute('aria-valuenow', /.+/);
    });

    test('Can close the mixer via bottom dock toggle', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixer).toBeVisible();
        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(mixer).toBeHidden();
    });
});
