import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function open_midi_editor(page: import('@playwright/test').Page): Promise<void> {
    await add_track(page, 'MIDI');
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);
    for (let attempt = 0; attempt < 5; attempt++) {
        await timeline.click({ position: { x: 300, y: 30 } });
        const zoom = page.getByTestId('toolbar-zoom');
        if (await zoom.isVisible().catch(() => false)) {
            return;
        }
        await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('toolbar-zoom')).toBeVisible({ timeout: 5000 });
}

// Horizontal zoom slider keyboard response. Existing specs assert the slider
// EXISTS with a numeric aria-valuenow — existence-only. This asserts ArrowUp
// changes the value (a real zoom-level state change).
test.describe('Horizontal zoom — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_midi_editor(page);
    });

    test('vertical slider reaches both boundaries with the keyboard', async ({ page }) => {
        const vertical = page.getByRole('slider', { name: 'Vertical zoom' });
        const horizontal = page.getByRole('slider', { name: 'Horizontal zoom' });
        await expect(vertical).toHaveAttribute('aria-valuenow', '16');
        await vertical.focus();
        await page.keyboard.press('Home');
        await expect(vertical).toHaveAttribute('aria-valuenow', '8');
        await page.keyboard.press('End');
        await expect(vertical).toHaveAttribute('aria-valuenow', '32');
        await page.keyboard.press('ArrowDown');
        await expect(vertical).toHaveAttribute('aria-valuenow', '31');
        await expect(horizontal).toHaveAttribute('aria-valuenow', '100');
    });

    test('zoom slider responds to ArrowUp', async ({ page }) => {
        const zoom = page.getByTestId('toolbar-zoom').getByRole('slider');
        await expect(zoom).toBeVisible({ timeout: 5000 });
        await zoom.focus();
        const before = Number(await zoom.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await zoom.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
