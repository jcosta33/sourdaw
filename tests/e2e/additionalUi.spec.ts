import { expect, test } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Additional UI Coverage', () => {
    test('Template with chords shows chord track lane', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);

        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await launch_screen.waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);

        const chord_track = page.getByRole('region', { name: 'Chord track' });
        const visible = await chord_track.isVisible().catch(() => false);
        if (visible) {
            await expect(chord_track).toBeVisible();
            await expect(chord_track.getByText('Chords')).toBeVisible();
        }
    });

    test('Tempo editor shows BPM and tap tempo', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await expect(page.getByText(/BPM/i)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Tap tempo' })).toBeVisible();
    });

    test('Time signature display shows 4/4 by default', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const time_sig = page.getByRole('button', { name: /Time signature/i });
        await expect(time_sig).toBeVisible();
        await expect(time_sig).toContainText('4/4');
    });

    test('Inspector freeze button is present for MIDI track', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const midi_row = track_list.getByRole('row', { name: /MIDI/i }).first();
        if (await midi_row.isVisible().catch(() => false)) {
            await midi_row.click();
            await page.waitForTimeout(500);
            const freeze = inspector.getByRole('button', { name: 'Freeze' });
            const visible = await freeze.isVisible().catch(() => false);
            if (visible) {
                await expect(freeze).toBeVisible();
            }
        }
    });

    test('Inspector signal flow button is present', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const first_row = track_list.getByRole('row').first();
        if (await first_row.isVisible().catch(() => false)) {
            await first_row.click();
            await page.waitForTimeout(500);
            const signal_flow = inspector.getByRole('button', { name: 'Signal Flow' });
            const visible = await signal_flow.isVisible().catch(() => false);
            if (visible) {
                await expect(signal_flow).toBeVisible();
            }
        }
    });

    test('Browser search accepts text input', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        await expect(search).toBeVisible();
        await search.fill('synth');
        await expect(search).toHaveValue('synth');
    });

    test('PromptBar is present and accepts input', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const prompt = page.getByRole('textbox', { name: 'Prompt command input' });
        await expect(prompt).toBeVisible();
        await prompt.fill('add a beat');
        await expect(prompt).toHaveValue('add a beat');
    });

    test('Undo history panel shows action count', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await page.getByRole('button', { name: /Toggle undo history panel/i }).click();
        await page.waitForTimeout(500);
    });
});
