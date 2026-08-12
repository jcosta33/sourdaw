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

// The Fermenter panel opens on the Oscillator section. The LFO block is not its
// own SectionNav tab — it is co-rendered inside the "Envelopes" section (see
// FermenterPanel.renderSectionContent for section === 'env'), so reaching the
// LFO knobs requires switching to Envelopes first.
//
// The Rate knob renders no `label` prop (its visible "Rate" caption is a
// sibling span), so RotaryKnob falls back to its paramId for the accessible
// name — the slider is addressable as "lfoRate". Rate is unipolar (0..20,
// default 0), so ArrowUp always advances it; the bipolar → Pitch / → Filter
// knobs sit at their 0 default and a single ArrowUp cannot escape their
// center dead-zone, so Rate is the knob this spec exercises.
test.describe('Fermenter LFO knob — reachable + responsive', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('the LFO Rate knob responds to keyboard', async ({ page }) => {
        // Switch from the default Oscillator section to Envelopes, where the
        // LFO block lives. The contract is the slider becoming present — not a
        // fixed delay.
        await page.getByRole('button', { name: 'Envelopes', exact: true }).click();

        const rate = page.getByRole('slider', { name: 'lfoRate' });
        await expect(rate).toBeVisible({ timeout: 5000 });
        await rate.focus();
        const before = Number(await rate.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await rate.getAttribute('aria-valuenow'));
        // Rate defaults to 0 (its minimum), so ArrowUp must advance it.
        expect(after).toBeGreaterThan(before);
    });
});
