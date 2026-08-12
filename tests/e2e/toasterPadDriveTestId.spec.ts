import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    // The Toaster card must be reachable; if it is not, fail rather than skip.
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the first pad renders once ToasterPanel is up.
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// Per-pad "Crunch" (drive) is the selected pad's character-shaping parameter.
// It is a RotaryKnob (`role="slider"`) wired to `setToasterPadParam(... 'drive' ...)`,
// so keyboard nudges must move `aria-valuenow` by the declared step (0.1). This
// covers the keyboard path for that knob — the per-pad "Tone" knob is already
// exercised by toasterPerPadParamsTestId.spec.ts.
test.describe('Toaster pad drive knob — keyboard control', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('ArrowUp increases the selected pad Crunch knob value', async ({ page }) => {
        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();

        const driveKnob = page.getByRole('slider', { name: 'Crunch' });
        await expect(driveKnob).toBeVisible({ timeout: 5000 });

        const before = Number(await driveKnob.getAttribute('aria-valuenow'));
        await driveKnob.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await driveKnob.getAttribute('aria-valuenow'));

        // The knob must honour its declared step (0.1), not just nudge vaguely.
        expect(after).toBeGreaterThan(before);
        expect(after).toBeCloseTo(before + 0.1, 5);
    });

    test('ArrowDown decreases the Crunch knob value after an increase', async ({ page }) => {
        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();

        const driveKnob = page.getByRole('slider', { name: 'Crunch' });
        await expect(driveKnob).toBeVisible({ timeout: 5000 });

        await driveKnob.focus();
        // Raise first so a decrease has somewhere to land.
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const raised = Number(await driveKnob.getAttribute('aria-valuenow'));

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        const lowered = Number(await driveKnob.getAttribute('aria-valuenow'));

        expect(lowered).toBeLessThan(raised);
        expect(lowered).toBeCloseTo(raised - 0.1, 5);
    });
});
