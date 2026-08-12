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
        if (await clip_content.first().isVisible().catch(() => false)) {
            return;
        }
        await page.waitForTimeout(300);
    }
    await expect(clip_content.first()).toBeVisible({ timeout: 5000 });
}

// Clip inspector trim/fade/gain keyboard response. Existing spec asserts the
// sliders EXIST (aria-valuenow not null) but never tests keyboard changes the
// value. This asserts Fade in + Clip gain respond to ArrowUp.
test.describe('Clip inspector trim/fade/gain — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await create_and_select_clip(page);
    });

    test('Fade in slider responds to keyboard', async ({ page }) => {
        const fadeIn = page.getByRole('slider', { name: 'Fade in duration' });
        await expect(fadeIn).toBeVisible({ timeout: 5000 });
        await fadeIn.focus();
        const before = Number(await fadeIn.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await fadeIn.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('Clip gain slider responds to keyboard', async ({ page }) => {
        const gain = page.getByRole('slider', { name: 'Clip gain' });
        await expect(gain).toBeVisible({ timeout: 5000 });
        await gain.focus();
        const before = Number(await gain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
