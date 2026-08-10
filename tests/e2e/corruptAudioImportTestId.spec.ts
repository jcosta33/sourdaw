import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// Error-path coverage for audio import. The happy path (valid WAV → clip) is
// covered by audioImportDropTestId; the rejection branch is not. Both audio
// import use cases (importAudioFile and importAudioClipToTrack) catch a
// decodeAudioFile failure and notifyUser(`Failed to import "${file.name}" —
// unsupported format or corrupt file`, 'error'). This spec feeds garbage bytes
// named .wav via the track-context Import Audio entry and asserts the error
// toast surfaces and no clip is added.
test.describe('Corrupt audio import — rejected with error toast, no clip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        // Need a track to import into; use the empty-state MIDI Keys button.
        const midi = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await midi.click();
        await page.getByRole('grid', { name: /Track list/i }).first().getByRole('row').first().waitFor({ state: 'visible' });
    });

    test('a non-audio .wav surfaces an error toast and adds no clip', async ({ page }) => {
        // Open the bottom dock's Editor tab to read the clip-count, before the
        // import so the layout is stable.
        const dockToggle = page.getByTestId('toggle-bottom-dock');
        if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
            await dockToggle.click();
            await page.waitForTimeout(400);
        }
        await page.getByRole('tab', { name: 'Editor' }).click();
        await page.waitForTimeout(400);

        // No clips before the failed import (the track is empty).
        await expect(page.getByTestId('selected-track-clip-count')).toContainText(/0 clips/i);

        // Feed garbage bytes as a .wav — not decodable audio.
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('menuitem', { name: /Import Audio/i }).click();
        const fileChooser = await chooser;
        await fileChooser.setFiles({
            name: 'corrupt.wav',
            mimeType: 'audio/wav',
            buffer: Buffer.from('not audio data'.repeat(64)),
        });

        // The error toast renders naming the file and the corrupt-format reason.
        const toast = page.getByRole('alert');
        await expect(toast).toBeVisible({ timeout: 10_000 });
        await expect(toast).toContainText(/corrupt\.wav/i);
        await expect(toast).toContainText(/unsupported format or corrupt file/i);

        // No clip was added by the failed import.
        await expect(page.getByTestId('selected-track-clip-count')).toContainText(/0 clips/i);
    });
});
