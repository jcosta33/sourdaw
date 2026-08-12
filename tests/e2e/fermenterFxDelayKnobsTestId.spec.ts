import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Open the Fermenter device panel from the Browser search.
 *
 * The panel-open gesture can hang on the synthetic React pointer handler: the
 * card click returns but the panel never mounts. So this helper tries a native
 * click first, waits on the panel-mounted contract (the `Close Fermenter`
 * control), and on a 30s timeout falls back to a DOM-level `dispatchEvent`
 * click. Two attempts; if neither mounts the panel we surface a recognizable
 * blocker rather than riding the suite ceiling.
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

// The Fermenter Effects section's Delay sub-tab renders three knobs (Mix, Time,
// Feedback) once the Effects section is active and the Delay chip is pressed.
// The FX sub-tab switch is covered by fermenterEffectsTabsTestId.spec.ts; this
// spec covers the Delay Time and Feedback knobs' keyboard interaction. Both
// sit below their max (delayTime 375 of 2000 ms; delayFeedback 0.35 of 0.95),
// so ArrowUp has headroom and aria-valuenow must advance.
//
// The Effects section button and the FX sub-tab chips sit behind clipping
// ancestors in the Fermenter panel's bottom dock (and Space is transport
// play/stop), so a coordinate-based pointer click is reported as intercepted.
// Dispatching a click event on the node fires the same React onClick each
// control routes through. Every locator is scoped to `.fermenter-faceplate`
// because the Browser panel also exposes an "Effects" button and "Delay" can
// appear in other contexts; within the faceplate each name is unique.
test.describe('Fermenter Effects Delay knobs — named + responsive', () => {
    test.beforeEach(async ({ page }) => {
        // Panel-open alone can need the full 30s hang bound under contention.
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);

        const panel = page.locator('.fermenter-faceplate');

        // The panel opens on the Oscillator section; navigate to Effects so the
        // FX sub-tab chips render.
        await panel.getByRole('button', { name: 'Effects', exact: true }).dispatchEvent('click');

        // Switch to the Delay sub-tab. Wait for the chip to mount after the
        // section swap, then dispatch the click.
        const delayChip = panel.getByRole('button', { name: 'Delay', exact: true });
        await expect(delayChip).toBeAttached({ timeout: 5_000 });
        await delayChip.dispatchEvent('click');
        await expect(delayChip).toHaveAttribute('aria-pressed', 'true');
    });

    test('the Delay Time knob responds to keyboard', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');
        const time = panel.getByRole('slider', { name: 'Time', exact: true });

        // The knob mounts inside the clipped FX dock; assert attachment rather
        // than actionability-visible — toBeAttached confirms the Delay tab
        // content swapped in without requiring the knob to be fully on-screen.
        await expect(time).toBeAttached({ timeout: 5_000 });
        await time.focus();
        const before = Number(await time.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await time.getAttribute('aria-valuenow'));
        // delayTime defaults to 375 ms (max 2000, step 1); ArrowUp advances it
        // unless already at the maximum.
        expect(after).toBeGreaterThan(before);
    });

    test('the Delay Feedback knob responds to keyboard', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');
        const feedback = panel.getByRole('slider', { name: 'Feedback', exact: true });

        await expect(feedback).toBeAttached({ timeout: 5_000 });
        await feedback.focus();
        const before = Number(await feedback.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await feedback.getAttribute('aria-valuenow'));
        // delayFeedback defaults to 0.35 (max 0.95, step 0.01); ArrowUp
        // advances it unless already at the maximum.
        expect(after).toBeGreaterThan(before);
    });
});
