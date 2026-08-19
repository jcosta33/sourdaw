import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// AiGeneration's PatternBrowser is the module's whole purpose: pick a MIDI
// pattern card → a clip + notes land on the timeline. This spec closes the gap
// where only the GenerativeAiPanel *tab toggle* (an AiRuntime surface) had E2E
// cover — the actual generate→insert mutation did not.
//
// Realism note: unlike the AI sub-tab (which needs a downloaded on-device
// model), the Patterns sub-tab generates notes from `PATTERN_TEMPLATES` — a set
// of pure, deterministic JS generators (see PatternBrowser.tsx →
// `template.generate(genParams)`). No model download, WebGPU, or desktop IPC
// is involved, so the insert flow runs identically in the headless browser.

test.describe('AiGeneration — pattern insert', () => {
    test('inserting a pattern card raises a success toast and creates a clip', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Open the Generate panel (aria-pressed toggle — confirmed by the
        // existing aiAndCollabFinal.spec.ts / aiFeatures.spec.ts covers).
        const generate = page.getByRole('button', { name: 'Generate', exact: true });
        await generate.click();

        // The panel opens on the MIDI tab → Patterns sub-tab by default
        // (GenerativeAiPanel.tsx: activeTab='midi', midiSubTab='patterns'), so
        // PatternBrowser is already mounted — no tab navigation needed. Wait on
        // an Insert control directly: it is present only once PatternBrowser
        // has rendered its pattern cards.
        const insertButton = page.getByRole('button', { name: /Insert 4-on-the-Floor at playhead/i });
        await expect(insertButton).toBeVisible({ timeout: 10_000 });

        // Before insert, no notification toast exists — the queue is empty and
        // NotificationToast returns null (useNotificationQueue).
        const toast = page.getByRole('alert');
        await expect(toast).toHaveCount(0);

        // "4-on-the-Floor" is a deterministic drum template — pure JS, no model.
        await insertButton.click();

        // The state change: handleInsertTemplate ends with
        // `notifyUser(`Inserted ${template.name} (${notes.length} notes)`, 'success')`,
        // fired only after addClip + batchAddMidiNotes succeed. The toast now
        // renders (role="alert") with the insert message — proving the full
        // generate→insert mutation ran, not mere panel existence.
        const successToast = page.getByRole('alert');
        await expect(successToast).toBeVisible({ timeout: 10_000 });
        await expect(successToast).toContainText(/Inserted 4-on-the-Floor \(\d+ notes\)/i);

        // The clip itself now exists on the timeline: its name is
        // `🎵 <template> (<key>)` and renders as a clip label. Asserting the
        // clip appears ties the toast to a real timeline mutation.
        const clipLabel = page.getByText(/🎵 4-on-the-Floor/i);
        await expect(clipLabel.first()).toBeVisible({ timeout: 10_000 });
    });
});
