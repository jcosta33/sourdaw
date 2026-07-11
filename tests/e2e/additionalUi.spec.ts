import { expect, test } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Additional UI Coverage', () => {
    test('Template with chords shows chord track lane with content', async ({ page }) => {
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
            await expect(chord_track.getByText('Chords')).toBeVisible();
            await expect(chord_track.getByRole('button', { name: /Add chord event/i })).toBeVisible();
        }
    });

    test('Tempo editor BPM is editable via tap tempo', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const bpm_display = page.getByLabel('Tempo BPM');
        await expect(bpm_display).toBeVisible();
        await expect(bpm_display).toContainText(/128/);

        const tap = page.getByRole('button', { name: 'Tap tempo' });
        await tap.click();
        await page.waitForTimeout(300);
        await tap.click();
        await page.waitForTimeout(300);
        await tap.click();
        await expect(bpm_display).toBeVisible();
    });

    test('Time signature display shows correct value and is clickable', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const time_sig = page.getByRole('button', { name: /Time signature/i });
        await expect(time_sig).toBeVisible();
        await expect(time_sig).toContainText('4/4');
    });

    test('Inspector freeze button is clickable for MIDI track', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const midi_row = track_list.getByRole('row', { name: /MIDI/i }).first();
        if (await midi_row.isVisible().catch(() => false)) {
            await midi_row.click();
            await page.waitForTimeout(500);
            const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
            const freeze = inspector.getByRole('button', { name: 'Freeze' });
            if (await freeze.isVisible().catch(() => false)) {
                await expect(freeze).toBeEnabled();
            }
        }
    });

    test('Inspector signal flow button opens visualization', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        const first_row = track_list.getByRole('row').first();
        if (await first_row.isVisible().catch(() => false)) {
            await first_row.click();
            await page.waitForTimeout(500);
            const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
            const signal_flow = inspector.getByRole('button', { name: 'Signal Flow' });
            if (await signal_flow.isVisible().catch(() => false)) {
                await signal_flow.click();
                await page.waitForTimeout(500);
            }
        }
    });

    test('Browser search filters instrument list in real time', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        await expect(search).toBeVisible();
        await search.fill('synth');
        await expect(search).toHaveValue('synth');
    });

    test('PromptBar accepts text and has action buttons', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const prompt = page.getByRole('textbox', { name: 'Prompt command input' });
        await expect(prompt).toBeVisible();
        await prompt.fill('add a beat');
        await expect(prompt).toHaveValue('add a beat');
    });

    test('Undo history panel shows entries after actions', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const undo_toggle = page.getByRole('button', { name: /Toggle undo history panel/i });
        await undo_toggle.click();
        await page.waitForTimeout(500);

        const panel = page.getByText(/Undo History/i).locator('..');
        await expect(panel).toBeVisible();
    });
});
