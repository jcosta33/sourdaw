import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

/**
 * Depth coverage for the Export "Render range" radios.
 *
 * `exportRangeTailTestId.spec.ts` only asserts the Loop / Marquee radios are
 * present and *disabled* in a fresh project, and that Whole project is the
 * default. It never exercises the selection itself — i.e. that clicking an
 * enabled radio actually changes which option is checked. That is the gap
 * these specs close: set a real loop region via the beat ruler's Shift+drag
 * (the gesture `BeatRulerBar` commits through `setLoopRegion`), open The
 * Bakery, and assert the checked radio follows the click in both directions.
 */

async function setLoopRegionViaRuler(page: import('@playwright/test').Page): Promise<void> {
    // Shift+drag on the beat ruler is the documented loop-region gesture
    // (title="... Shift+drag to set loop region ..."). A horizontal drag of
    // well over 0.25 beats commits `setLoopRegion` on mouseup, which makes
    // `transport.loopEnd > transport.loopStart` and so enables the Loop radio.
    const ruler = page.getByLabel('Beat ruler');
    await expect(ruler).toBeVisible({ timeout: 10_000 });
    const box = await ruler.boundingBox();
    if (!box) {
        throw new Error('Beat ruler bounding box not available');
    }
    const y = box.y + box.height / 2;
    const startX = box.x + 30;
    const endX = box.x + Math.min(box.width - 10, 280);

    await page.mouse.move(startX, y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
}

async function openExportDialog(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

test.describe('Export range radio selection — depth', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        // The EDM template ships with tracks, so the timeline + beat ruler are
        // already mounted (an empty project delays timeline render until a
        // track is added).
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('clicking the Loop radio changes the checked range option', async ({ page }) => {
        await setLoopRegionViaRuler(page);
        await openExportDialog(page);

        const radiogroup = page.getByRole('radiogroup', { name: 'Render range' });
        const wholeProject = radiogroup.getByLabel('Whole project');
        const loopRegion = radiogroup.getByLabel(/Loop region/i);

        // The loop region drag must have enabled the Loop radio.
        await expect(loopRegion).toBeEnabled({ timeout: 5000 });

        // Whole project starts checked; Loop is not.
        await expect(wholeProject).toBeChecked();
        await expect(loopRegion).not.toBeChecked();

        // Selecting Loop flips the checked radio — the selection behavior the
        // sibling presence/disabled specs never exercise.
        await loopRegion.click();
        await expect(loopRegion).toBeChecked();
        await expect(wholeProject).not.toBeChecked();
    });

    test('Loop → Whole project round-trips the checked radio back', async ({ page }) => {
        await setLoopRegionViaRuler(page);
        await openExportDialog(page);

        const radiogroup = page.getByRole('radiogroup', { name: 'Render range' });
        const wholeProject = radiogroup.getByLabel('Whole project');
        const loopRegion = radiogroup.getByLabel(/Loop region/i);

        await expect(loopRegion).toBeEnabled({ timeout: 5000 });
        await loopRegion.click();
        await expect(loopRegion).toBeChecked();

        // Switching back to Whole project re-checks it and deselects Loop —
        // mutual exclusivity of the radio group, asserted in both directions.
        await wholeProject.click();
        await expect(wholeProject).toBeChecked();
        await expect(loopRegion).not.toBeChecked();
    });
});
