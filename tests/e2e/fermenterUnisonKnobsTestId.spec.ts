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

// Fermenter's Unison knobs (Voices/Detune/Spread) announced as their paramId
// ("unisonVoices" etc.) because UnisonSection passed paramId but no accessible
// name, while rendering the visible label as a sibling span. The wrapper now
// forwards aria-label (matching the visible span), so each knob is addressable
// by name. This spec covers the Voices knob's keyboard interaction — previously
// the paramId fallback made it untargetable.
test.describe('Fermenter Unison knobs — named + responsive', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('the Unison Voices knob responds to keyboard', async ({ page }) => {
        const voices = page.getByRole('slider', { name: 'Voices' });
        await expect(voices).toBeVisible({ timeout: 5000 });
        await voices.focus();
        const before = Number(await voices.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await voices.getAttribute('aria-valuenow'));
        // Voices is an integer count (1..16); ArrowUp advances it by one.
        expect(after).toBeGreaterThan(before);
    });

    test('the Unison Detune knob responds to keyboard', async ({ page }) => {
        const detune = page.getByRole('slider', { name: 'Detune' });
        await expect(detune).toBeVisible({ timeout: 5000 });
        await detune.focus();
        const before = Number(await detune.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await detune.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
