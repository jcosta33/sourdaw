import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function create_and_select_clip(page: import('@playwright/test').Page): Promise<void> {
    await add_track(page, 'MIDI');
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    const clip_content = inspector.getByText(/Clip Gain|Trim Start/i);
    for (let attempt = 0; attempt < 5; attempt++) {
        await timeline.click({ position: { x: 300, y: 30 } });
        if (await clip_content.first().isVisible().catch(() => false)) { return; }
        await page.waitForTimeout(300);
    }
    await expect(clip_content.first()).toBeVisible({ timeout: 5000 });
}

// Clip inspector Trim end + Fade out keyboard response. #1817 covered Fade in
// + Clip gain. These complete the 5-slider clip inspector matrix.
test.describe('Clip inspector Trim end + Fade out — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await create_and_select_clip(page);
    });

    test('Trim clip end slider responds to keyboard', async ({ page }) => {
        const trimEnd = page.getByRole('slider', { name: 'Trim clip end' });
        await expect(trimEnd).toBeVisible({ timeout: 5000 });
        await trimEnd.focus();
        const before = Number(await trimEnd.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await trimEnd.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Fade out slider responds to keyboard', async ({ page }) => {
        const fadeOut = page.getByRole('slider', { name: 'Fade out duration' });
        await expect(fadeOut).toBeVisible({ timeout: 5000 });
        await fadeOut.focus();
        const before = Number(await fadeOut.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await fadeOut.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
