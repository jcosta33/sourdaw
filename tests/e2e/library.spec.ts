import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

// A small bundled WAV fixture — imported through the Browser's file input so a
// real, previewable, draggable sample row exists for the test.
const SAMPLE_FIXTURE = fileURLToPath(
    new URL('../../public/samples/levain/clarinet/DCClar_stac_F2_v1_rr1_sum.wav', import.meta.url)
);
const SAMPLE_NAME = 'DCClar_stac_F2_v1_rr1_sum';

test.describe('Sample Library', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Load the EDM template so a real Timeline editor surface exists as the
        // drag target.
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();

        const edmTemplateButton = page.getByRole('button', { name: /EDM/i });
        await edmTemplateButton.waitFor({ state: 'visible' });
        await edmTemplateButton.click();

        // Wait for the workspace to initialize
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Can open the Samples tab, preview a sample, and initiate a drag toward the timeline', async ({ page }) => {
        // Open the Browser panel if it is not already showing.
        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browserPanel.isVisible())) {
            await page.getByRole('button', { name: /Toggle browser/i }).click();
            await expect(browserPanel).toBeVisible();
        }

        // Navigate to the Library tab, then the "Imported" samples sub-tab (the
        // Samples surface — it renders the SamplesTab list).
        await browserPanel.getByRole('button', { name: 'Library', exact: true }).click();
        const importedSubTab = browserPanel.getByRole('button', { name: 'Imported', exact: true });
        await expect(importedSubTab).toBeVisible();
        await importedSubTab.click();

        // Import a real WAV through the hidden file input so a sample row exists.
        const fileInput = browserPanel.locator('input[type="file"]');
        await fileInput.setInputFiles(SAMPLE_FIXTURE);

        // The decoded sample appears as a draggable row.
        const sampleRow = browserPanel.getByText(SAMPLE_NAME, { exact: true });
        await expect(sampleRow).toBeVisible();

        // Preview the sample — the preview control flips to its "Stop" state.
        const previewButton = browserPanel.getByRole('button', { name: 'Preview sound' }).first();
        await expect(previewButton).toBeVisible();
        await previewButton.click();
        await expect(browserPanel.getByRole('button', { name: 'Stop preview' })).toBeVisible();

        // Initiate a drag of the sample toward the timeline. HTML5 drag-and-drop
        // is driven through real dragstart/dragover events sharing one
        // DataTransfer; the timeline surface reacts to dragover by revealing its
        // drop overlay, which is the observable proof the drag reached it.
        const dragSource = sampleRow.locator('xpath=ancestor-or-self::*[@draggable="true"][1]');
        const timeline = page.getByLabel('Timeline editor surface');
        await expect(timeline).toBeVisible();

        const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
        await dragSource.dispatchEvent('dragstart', { dataTransfer });
        await timeline.dispatchEvent('dragenter', { dataTransfer });
        await timeline.dispatchEvent('dragover', { dataTransfer });

        // The timeline shows its "Drop ... here" overlay while a drag hovers it.
        await expect(page.getByText('Drop audio or MIDI files here')).toBeVisible();

        // Release the drag so no dangling drag state leaks into other tests.
        await timeline.dispatchEvent('dragleave', { dataTransfer });
    });
});
