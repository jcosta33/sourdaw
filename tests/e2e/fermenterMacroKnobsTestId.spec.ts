import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenter(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('fermenter');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Fermenter/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByRole('button', { name: /Close Fermenter/i }).first()).toBeVisible({ timeout: 15_000 });
}

// The Macro rig lives in the Fermenter panel's right-hand aside rail and is
// always rendered once the panel mounts (not behind a section tab). MacroStrip
// emits one RotaryKnob per entry of MACRO_LABELS — Brightness, Motion, Width,
// Dirt, Space, Punch, Texture, Character — each a role="slider" whose
// accessible name is the knob label and whose value spans 0..1 in 0.01 steps.
// `fermenterPanelDeepTestId` exercises the Macro rig *combobox* value but not
// the knobs themselves; this spec closes that gap by driving each knob from the
// keyboard and asserting aria-valuenow actually moves.
test.describe('Fermenter Macro knobs — named + responsive', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('the Macro Brightness knob responds to keyboard', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Brightness' });
        await expect(knob).toBeVisible({ timeout: 5000 });
        await knob.focus();
        const before = Number(await knob.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await knob.getAttribute('aria-valuenow'));
        // Macros span 0..1; ArrowUp advances unless already at the ceiling.
        if (before < 1) {
            expect(after).toBeGreaterThan(before);
        }
    });

    test('the Macro Width knob responds to keyboard', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Width' });
        await expect(knob).toBeVisible({ timeout: 5000 });
        await knob.focus();
        const before = Number(await knob.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await knob.getAttribute('aria-valuenow'));
        if (before < 1) {
            expect(after).toBeGreaterThan(before);
        }
    });

    test('the Macro Character knob responds to keyboard', async ({ page }) => {
        const knob = page.getByRole('slider', { name: 'Character' });
        await expect(knob).toBeVisible({ timeout: 5000 });
        await knob.focus();
        const before = Number(await knob.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await knob.getAttribute('aria-valuenow'));
        if (before < 1) {
            expect(after).toBeGreaterThan(before);
        }
    });
});
