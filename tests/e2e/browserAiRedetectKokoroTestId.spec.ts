import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

type Page = import('@playwright/test').Page;

/** Open Preferences and navigate to the AI section, whose "Browser AI" FieldGroup
 *  hosts CapabilityReportPanel. Waits on the section's unique first FieldGroup
 *  label so later assertions target mounted content, not a clicked nav button. */
async function open_preferences_ai_section(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(dialog.getByText('AI execution backend').first()).toBeVisible();
}

/** Add a MIDI track, create a clip at x=300, and select it so the clip inspector
 *  (and its ClipMidiAiSection) renders. Mirrors clipInspectorControls.spec.ts:
 *  clip selection clicks are retried because clips are canvas-rendered. */
async function create_and_select_clip(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();

    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);

    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    const clip_content = inspector.getByText(/Clip Gain|Trim Start/i);

    for (let attempt = 0; attempt < 5; attempt++) {
        await timeline.click({ position: { x: 300, y: 30 } });
        if (await clip_content.first().isVisible().catch(() => false)) {
            return;
        }
        await page.waitForTimeout(300);
    }
    await expect(clip_content.first()).toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Browser AI — Preferences capability report refresh, and the Kokoro TTS voice
// selector's mount state in the clip inspector.
// ---------------------------------------------------------------------------

test.describe('Browser AI — Re-detect capabilities and Kokoro voice mount', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Re-detect capabilities re-runs detection without crashing the panel', async ({ page }) => {
        const page_errors: string[] = [];
        page.on('pageerror', (error) => page_errors.push(String(error)));

        await open_preferences_ai_section(page);

        // Bootstrap already ran a cold-start detection, so the panel shows its
        // report (role=status region) with the Refresh affordance.
        const panel = page.getByRole('status', { name: 'Browser AI capabilities' });
        const redetect = page.getByRole('button', { name: 'Re-detect capabilities' });
        await expect(panel).toBeVisible({ timeout: 10_000 });
        await expect(redetect).toBeVisible();

        await redetect.click();

        // Detection swaps the panel through its transient "Detecting…" state and
        // back; the report region must re-mount inside the still-open dialog.
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(panel).toBeVisible({ timeout: 20_000 });
        await expect(redetect).toBeVisible();
        expect(page_errors).toEqual([]);
    });

    test('Kokoro TTS voice selector is gated behind the voice model download', async ({ page }) => {
        await create_and_select_clip(page);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        // The clip inspector's AI Actions section mounts for a MIDI clip, with
        // the Vocals card defaulting to Spoken (Kokoro TTS) mode.
        await expect(inspector.getByText('AI Actions')).toBeVisible();
        await expect(inspector.getByText('Vocals', { exact: true })).toBeVisible();

        // With no voice model in OPFS, the section shows the download gate
        // instead of the 21-voice selector.
        await expect(inspector.getByText('Download a voice to get started')).toBeVisible();
        await expect(inspector.getByRole('button', { name: /Download Voice Model/i })).toBeVisible();
        await expect(inspector.getByLabel('Kokoro TTS voice')).toHaveCount(0);
    });
});
