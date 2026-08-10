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

// Toaster's per-pad parameters (Hit/Tone/Drive) are per-pad state: the selected
// pad's values drive the knob row, so changing a param on pad 0 must not affect
// pad 1's value. The existing "parameter sliders" test is existence-only; this
// covers the real per-pad isolation flow.
test.describe('Toaster per-pad params — isolation across pads', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('changing Tone on pad 0 does not change pad 1 Tone', async ({ page }) => {
        // Select pad 0 and read its Tone knob value.
        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();
        const toneKnob = page.getByRole('slider', { name: 'Tone' });
        await expect(toneKnob).toBeVisible({ timeout: 5000 });
        const pad0ToneBefore = Number(await toneKnob.getAttribute('aria-valuenow'));

        // Nudge pad 0's Tone up so the value moves off its default.
        await toneKnob.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const pad0ToneAfter = Number(await toneKnob.getAttribute('aria-valuenow'));

        // Select pad 1 and read its Tone — it must hold its own value, not pad
        // 0's changed value. Per-pad isolation is the param row's contract.
        const pad1 = page.getByTestId('toaster-pad-1');
        await pad1.click();
        await expect(pad1).toHaveAttribute('aria-pressed', 'true');
        const pad1Tone = Number(await toneKnob.getAttribute('aria-valuenow'));

        expect(pad0ToneAfter).toBeGreaterThan(pad0ToneBefore);
        expect(pad1Tone).not.toBe(pad0ToneAfter);
    });
});
