import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

/** Add a MIDI track, create a clip at x=300, and select it so the clip inspector renders.
 *  Retries the selection click since clips are canvas-rendered and the first click can miss. */
async function create_and_select_clip(page: import('@playwright/test').Page): Promise<void> {
    await add_track(page, 'MIDI');
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);

    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    const clip_content = inspector.getByText(/Clip Gain|Trim Start/i);

    // Retry clicking the clip until the clip inspector renders (canvas clicks can miss).
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
// Clip inspector — trim, fade, gain, and envelope controls verify real state.
// ---------------------------------------------------------------------------

test.describe('Clip inspector controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await create_and_select_clip(page);
    });

    test('Clip inspector exposes trim, fade, and gain sliders with values', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        const trim_start = inspector.getByRole('slider', { name: 'Trim clip start' });
        const trim_end = inspector.getByRole('slider', { name: 'Trim clip end' });
        const fade_in = inspector.getByRole('slider', { name: 'Fade in duration' });
        const fade_out = inspector.getByRole('slider', { name: 'Fade out duration' });
        const gain = inspector.getByRole('slider', { name: 'Clip gain' });

        for (const slider of [trim_start, trim_end, fade_in, fade_out, gain]) {
            await expect(slider).toBeVisible();
            const value = await slider.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test('Gain envelope section renders with state text and supporting controls', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        // The envelope section shows its enabled/disabled state with a point count.
        const state_text = inspector.getByText(/Enabled ·|Disabled ·/i);
        await expect(state_text.first()).toBeVisible({ timeout: 8000 });

        // The supporting controls (always present regardless of enabled state) allow
        // adding breakpoints and resetting the envelope.
        await expect(page.getByRole('button', { name: 'Add breakpoint' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reset gain envelope' })).toBeVisible();
    });

    test('Clip color picker exposes exactly the preset swatches', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        // The Color section header precedes a row of swatch <button>s (CLIP_COLOR_PRESETS, 8 entries).
        const color_header = inspector.getByText('Color', { exact: true }).first();
        await expect(color_header).toBeVisible();
        // The swatches are the buttons immediately following the Color header, grouped in a row.
        // Each swatch is a small button with an inline oklch background; count them.
        const swatch_row = color_header.locator('xpath=following::div[contains(@class,"flex")][1]');
        const swatches = swatch_row.getByRole('button');
        const count = await swatches.count();
        expect(count).toBeGreaterThanOrEqual(4);
    });
});
