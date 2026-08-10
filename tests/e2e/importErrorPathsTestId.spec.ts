import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Error-path coverage: a corrupt MIDI file must surface an error notification
// and add no track. The existing MIDI import spec covers the happy path
// (midiExportDownloadTestId); the rejection branch is uncovered.
//
// importMidiFile (Arrangement use case) catches a parse failure from
// readMidiFile and calls notifyUser(`Failed to import "${file.name}" -
// invalid or corrupt MIDI file`, 'error') — rendered as a role="alert" toast.
// The track count must not rise.
test.describe('Import error paths — corrupt MIDI rejected', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('a corrupt .mid surfaces an error toast and adds no track', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();

        // Add an Audio track so the Import MIDI entry is reachable, then record
        // the count as the baseline a failed import must not change.
        await page.keyboard.press(`${MOD}+K`);
        const palette = page.getByTestId('command-palette-input');
        await palette.fill('Add Audio Track');
        await page.waitForTimeout(300);
        await palette.press('Enter');
        await page.waitForTimeout(800);
        const tracksAfterAdd = await trackList.getByRole('row').count();
        expect(tracksAfterAdd).toBeGreaterThanOrEqual(1);

        // Feed garbage bytes as a .mid — not a valid MIDI file.
        trackList.getByRole('row').first().click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('menuitem', { name: /Import MIDI/i }).click();
        const fileChooser = await chooser;
        await fileChooser.setFiles({
            name: 'corrupt.mid',
            mimeType: 'audio/midi',
            buffer: Buffer.from('this is not a midi file'.repeat(8)),
        });

        // The error toast renders (role="alert") naming the file and the
        // corrupt-MIDI reason.
        const toast = page.getByRole('alert');
        await expect(toast).toBeVisible({ timeout: 10_000 });
        await expect(toast).toContainText(/corrupt\.mid/i);
        await expect(toast).toContainText(/invalid or corrupt MIDI file/i);

        // No track was added by the failed import — the count is unchanged.
        await page.waitForTimeout(500);
        const tracksAfterImport = await trackList.getByRole('row').count();
        expect(tracksAfterImport).toBe(tracksAfterAdd);
    });
});
