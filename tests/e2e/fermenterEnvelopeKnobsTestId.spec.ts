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

// The Fermenter panel opens on the Oscillator section; the Envelope knobs only
// mount once the "Envelopes" section tab is clicked. EnvelopeSection passes
// paramId ("ampAttack" etc.) but no label/aria-label to the knob, so the
// slider's accessible name is the paramId itself. This spec covers the amp ADSR
// Attack and Sustain knobs' keyboard interaction — both default below their max
// (ampAttack 0.01 of 5; ampSustain 0.7 of 1), so ArrowUp has headroom.
test.describe('Fermenter Envelope knobs — named + responsive', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);

        // Switch from the default Oscillator section to Envelopes so the ADSR
        // knobs mount. The visible amp/filter toggle inside the section defaults
        // to amp, so the rendered paramIds are ampAttack/ampDecay/ampSustain/ampRelease.
        const envTab = page.getByRole('button', { name: 'Envelopes' });
        await envTab.click();
    });

    test('the Envelope Attack knob responds to keyboard', async ({ page }) => {
        const attack = page.getByRole('slider', { name: 'ampAttack', exact: true });
        await expect(attack).toBeVisible({ timeout: 5000 });
        await attack.focus();
        const before = Number(await attack.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await attack.getAttribute('aria-valuenow'));
        // Attack is a log-scaled time (0.001–5 s) defaulting to 0.01; ArrowUp
        // advances it unless already at the maximum.
        expect(after).toBeGreaterThan(before);
    });

    test('the Envelope Sustain knob responds to keyboard', async ({ page }) => {
        const sustain = page.getByRole('slider', { name: 'ampSustain', exact: true });
        await expect(sustain).toBeVisible({ timeout: 5000 });
        await sustain.focus();
        const before = Number(await sustain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await sustain.getAttribute('aria-valuenow'));
        // Sustain is linear (0–1) defaulting to 0.7; ArrowUp advances it.
        expect(after).toBeGreaterThan(before);
    });
});
