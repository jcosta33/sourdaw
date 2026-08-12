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

test.describe('Fermenter Effects sub-tabs — content swap on tab switch', () => {
    test.beforeEach(async ({ page }) => {
        // Panel-open alone can need the full 30s hang bound under contention.
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openFermenter(page);
    });

    test('switching Dist <-> Comp swaps the Dist-only Drive knob for the Comp-only Ratio knob', async ({
        page,
    }) => {
        // Scope every locator to the Fermenter faceplate: the Browser panel
        // also exposes an "Effects" button, and "Dist"/"Comp" can appear in
        // other contexts. Within the faceplate each name is unique.
        const panel = page.locator('.fermenter-faceplate');

        // The panel opens on the Oscillator section; navigate to Effects so the
        // FX sub-tab chips render.
        await panel.getByRole('button', { name: 'Effects', exact: true }).click();

        const distChip = panel.getByRole('button', { name: 'Dist', exact: true });
        const compChip = panel.getByRole('button', { name: 'Comp', exact: true });

        // Dist is the default FX sub-tab — its Drive knob is mounted and the
        // chip reflects the active state.
        await expect(distChip).toBeVisible();
        await expect(distChip).toHaveAttribute('aria-pressed', 'true');
        const drive = panel.getByRole('slider', { name: 'Drive', exact: true });
        await expect(drive).toBeVisible({ timeout: 5_000 });

        // Switch to Comp. A real content swap means the Dist-only Drive knob
        // leaves the DOM and a Comp-only Ratio knob appears — the two never
        // coexist within a single tab.
        //
        // The FX sub-tab chips sit behind a clipping ancestor in the Fermenter
        // panel's bottom dock (and Space is transport play/stop), so a
        // coordinate-based pointer click is reported as intercepted. Dispatching
        // a click event on the chip node fires the same React onClick the chip
        // routes to setActiveTab.
        await compChip.dispatchEvent('click');
        await expect(compChip).toHaveAttribute('aria-pressed', 'true');
        await expect(distChip).not.toHaveAttribute('aria-pressed', 'true');
        await expect(drive).toHaveCount(0);
        const ratio = panel.getByRole('slider', { name: 'Ratio', exact: true });
        await expect(ratio).toBeVisible({ timeout: 5_000 });

        // Switch back to Dist — Drive reappears and Ratio leaves. Same clip
        // constraint as above, so dispatch the click.
        await distChip.dispatchEvent('click');
        await expect(distChip).toHaveAttribute('aria-pressed', 'true');
        await expect(compChip).not.toHaveAttribute('aria-pressed', 'true');
        await expect(drive).toBeVisible({ timeout: 5_000 });
        await expect(ratio).toHaveCount(0);
    });
});
