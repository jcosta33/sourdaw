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
    const close = page.getByRole('button', { name: /Close Fermenter/i }).first();
    // Standard pointer click first; the panel-mounted Close control is the
    // panel-open contract.
    try {
        await card.click();
        await expect(close).toBeVisible({ timeout: 30_000 });
        return;
    } catch {
        // Some boots hang on a real pointer click without ever mounting the
        // panel; a synthetic click unblocks it. Anything past this point that
        // still fails is a genuine panel-open hang.
    }
    await card.dispatchEvent('click');
    await expect(close).toBeVisible({ timeout: 30_000 });
}

// The panel opens on the Oscillator section, so switch to Filter before
// exercising its knobs. SectionNav's "Filter" tab is the first Filter button in
// the DOM; a second "Filter" button sits in the oscillator's Audio-Rate Mod
// row and unmounts once the section flips, so the Cutoff-slider wait below is
// the section-switch contract.
async function openFilterSection(page: import('@playwright/test').Page): Promise<void> {
    await openFermenter(page);
    await page.getByRole('button', { name: /^Filter$/ }).first().click();
    await expect(page.getByRole('slider', { name: /^filterCutoff$/ })).toBeVisible({ timeout: 10_000 });
}

// The filter section's Drive/Env/Key knobs forward `label` to RotaryKnob and so
// are addressable by that label. Cutoff and Reso render their visible label as a
// sibling span and pass only `paramId`, so RotaryKnob announces them by paramId
// (ariaLabel ?? label ?? paramId). Both are still reachable by name — Cutoff by
// its exact paramId `filterCutoff`, Env by its exact label `Env` (the only knob
// in the Fermenter panel with that accessible name). This spec covers the two
// filter knobs' keyboard interaction, which no prior E2E exercised.
test.describe('Fermenter Filter knobs — addressable + keyboard responsive', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFilterSection(page);
    });

    test('the Filter Cutoff knob responds to keyboard', async ({ page }) => {
        const cutoff = page.getByRole('slider', { name: /^filterCutoff$/ });
        await expect(cutoff).toBeVisible({ timeout: 5000 });
        await cutoff.focus();
        const before = Number(await cutoff.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await cutoff.getAttribute('aria-valuenow'));
        // Cutoff default is 5000 Hz (max 20000); ArrowUp steps +10 Hz, so the
        // reported value must rise unless it was already pinned at the top.
        expect(after).toBeGreaterThan(before);
    });

    test('the Filter Env knob responds to keyboard', async ({ page }) => {
        const env = page.getByRole('slider', { name: /^Env$/ });
        await expect(env).toBeVisible({ timeout: 5000 });
        await env.focus();
        const before = Number(await env.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await env.getAttribute('aria-valuenow'));
        // Env amount default is 0.5 (max 1); ArrowUp steps +0.01, so the value
        // must rise unless it was already pinned at the top.
        expect(after).toBeGreaterThan(before);
    });
});
