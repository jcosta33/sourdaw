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

// Toaster's per-pad "Bright" knob maps to the selected pad's filterCutoff
// (20-20000 Hz). createDefaultPad ships filterCutoff at the max (20000), so an
// ArrowUp nudge is a no-op at that value; ArrowDown must move it off the
// ceiling by the knob's step (10). This is the behavioural contract — the knob
// both renders the live value and writes back through setToasterPadParam.
test.describe('Toaster per-pad Bright knob — keyboard nudge changes value', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('ArrowDown on the Bright slider lowers filterCutoff from its max default', async ({ page }) => {
        // Select pad 0 so the per-pad knob row reflects pad 0's filterCutoff.
        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();

        const brightKnob = page.getByRole('slider', { name: 'Bright' });
        await expect(brightKnob).toBeVisible({ timeout: 5000 });

        const before = Number(await brightKnob.getAttribute('aria-valuenow'));
        // The default pad ships filterCutoff at the ceiling; assert the starting
        // point so the test cannot silently flip to an ArrowUp scenario later.
        expect(before).toBe(20000);

        // ArrowUp is a no-op at the max, so nudge down off the ceiling.
        await brightKnob.focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);

        const after = Number(await brightKnob.getAttribute('aria-valuenow'));
        expect(after).toBeLessThan(before);
        // Step is 10; a single ArrowDown moves exactly one step off the max.
        expect(after).toBe(20000 - 10);
    });
});
