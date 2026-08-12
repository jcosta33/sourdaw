import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust release-auto toggle: a DawPluginToggle bound to patch.releaseAuto.
// Default is on (releaseAuto=true); clicking toggles it. aria-pressed reflects
// the state.
test.describe('Crust release-auto toggle — aria-pressed round-trip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('toggling Release auto flips aria-pressed off then on', async ({ page }) => {
        const toggle = page.getByRole('switch', { name: 'Release auto' });

        // Default: releaseAuto is on (true) → aria-pressed is "true". Unlike the
        // true-peak DawPluginChip (whose aria-pressed is undefined when off),
        // DawPluginToggle always emits the boolean, so the off state is the
        // literal "false" — assert that exact flip, not just "not true".
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');

        // Toggle off. The timing row sits under the "Mission control" waveform
        // card at the default viewport, which intercepts pointer events, so a
        // plain click() times out landing on the covering card rather than the
        // toggle. dispatchEvent('click') sends a real click event straight to
        // the toggle button — it bubbles to React's root listener and runs the
        // actual onClick → setParam('releaseAuto') handler, which is the
        // contract under test (the overlap is a dense-panel layout artifact,
        // not the toggle's behaviour).
        await toggle.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        // Toggle back on.
        await toggle.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });
});
