import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Open the Fermenter device panel from the Browser search.
 *
 * The panel-open gesture can hang on the synthetic React pointer handler: the
 * card click returns but the panel never mounts. So this helper tries a native
 * click first, waits on the panel-mounted contract (the `Close Fermenter`
 * control), and on a 30s timeout falls back to a DOM-level `dispatchEvent`
 * click. If neither mounts the panel we surface a recognizable blocker rather
 * than riding the suite ceiling.
 */
async function openFermenter(page: Page): Promise<void> {
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

    // Attempt 1: native actionability-driven click.
    await card.click({ timeout: 10_000 });
    if (await close.isVisible({ timeout: 30_000 }).catch(() => false)) {
        return;
    }

    // Attempt 2: dispatch a DOM-level click in case the React handler hangs on
    // the native pointer gesture.
    await card.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    if (await close.isVisible({ timeout: 30_000 }).catch(() => false)) {
        return;
    }

    throw new Error('blocked on panel-open hang');
}

/**
 * Land on the Fermenter Effects -> Reverb sub-tab.
 *
 * Every locator is scoped to `.fermenter-faceplate`: the Browser panel also
 * exposes an "Effects" button, and chip labels like "Reverb" can appear in
 * other contexts. Within the faceplate each name is unique.
 *
 * Both the Effects section button and the FX sub-tab chips sit behind a
 * clipping ancestor in the Fermenter panel's bottom dock, so a coordinate-based
 * pointer click is reported as intercepted (and Space is transport play/stop).
 * Dispatching a click event on the node fires the same React onClick the
 * SectionNav section switch and the chip's setActiveTab route to.
 */
async function openReverbTab(page: Page): Promise<void> {
    await openFermenter(page);

    const panel = page.locator('.fermenter-faceplate');

    // Switch from the default Oscillator section to Effects. The FX sub-tab
    // chips (Dist/Comp/Reverb/...) only render once the Effects section mounts,
    // so the Reverb chip becoming attached is the section-switch contract.
    await panel.getByRole('button', { name: 'Effects', exact: true }).dispatchEvent('click');
    const reverbChip = panel.getByRole('button', { name: 'Reverb', exact: true });
    await expect(reverbChip).toBeAttached({ timeout: 10_000 });

    // Switch to the Reverb sub-tab. aria-pressed reflects the chip's active
    // state; the reverb-only Decay knob mounting is the content-swap contract.
    await reverbChip.dispatchEvent('click');
    await expect(reverbChip).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('slider', { name: 'Decay', exact: true })).toBeAttached({
        timeout: 10_000,
    });
}

// The Reverb sub-tab exposes two rotary knobs — Mix (reverbMix, default 0.2,
// step 0.01) and Decay (reverbDecay, default 0.5, step 0.01). Both forward
// their `label` to RotaryKnob, so each is addressable as a slider by that
// label. Neither default is pinned at its max, so an ArrowUp keystroke must
// raise the reported value. No prior E2E exercised these knobs' keyboard
// interaction (the FX sub-tab switch is covered in #1781).
test.describe('Fermenter FX Reverb knobs — keyboard responsive', () => {
    test.beforeEach(async ({ page }) => {
        // Panel-open alone can need the full 30s hang bound under contention.
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openReverbTab(page);
    });

    test('the Reverb Mix knob responds to keyboard', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');
        const mix = panel.getByRole('slider', { name: 'Mix', exact: true });
        await expect(mix).toBeAttached({ timeout: 5000 });
        await mix.focus();
        const before = Number(await mix.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await mix.getAttribute('aria-valuenow'));
        // Mix default is 0.2 (max 1); ArrowUp steps +0.01, so the reported value
        // must rise unless it was already pinned at the top.
        expect(after).toBeGreaterThan(before);
    });

    test('the Reverb Decay knob responds to keyboard', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');
        const decay = panel.getByRole('slider', { name: 'Decay', exact: true });
        await expect(decay).toBeAttached({ timeout: 5000 });
        await decay.focus();
        const before = Number(await decay.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await decay.getAttribute('aria-valuenow'));
        // Decay default is 0.5 (max 0.99); ArrowUp steps +0.01, so the reported
        // value must rise unless it was already pinned at the top.
        expect(after).toBeGreaterThan(before);
    });
});
