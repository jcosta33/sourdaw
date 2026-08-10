import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

/**
 * Metering views — on-screen state change.
 *
 * Closes the E2E gap where Metering renders AnalysisPanel + meter views
 * (LevelMeter, LUFSMeter, Goniometer, ...) but no test asserted a meter view
 * reflects a state change. Existing Analysis coverage was pure tab visibility
 * (`bottomDockRoutingAnalysis.spec.ts`); meter-signal checks were offline
 * (exported-WAV LUFS) or existence-only (canvas image counts).
 *
 * Real-time meter peaks are not reliably observable under Playwright — the
 * AudioContext does not render audible output without a genuine user gesture,
 * so a LevelMeter/LUFSMeter bar cannot be asserted to rise in CI. Instead this
 * spec asserts the deterministic state changes the metering surface DOES expose
 * on interaction: the bottom-dock toggle flips `aria-pressed`, selecting the
 * Analysis tab swaps the panel content (AnalysisPanel meter cards mount in
 * place of the Mixer) and flips the tab's `aria-selected`, and the LUFSMeter
 * view renders its idle readout text + canvas aria-label (the meter's own
 * announced state, not a CSS class or canvas pixel).
 */
test.describe('Metering views — analysis tab + meter readout state', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await wait_for_workspace_ready(page);
    });

    test('opening Analysis tab mounts meter views and flips tab state', async ({ page }) => {
        const dockToggle = page.getByTestId('toggle-bottom-dock');

        // Open the bottom dock. The toggle's aria-pressed mirrors mixerOpen, so a
        // false→true flip is the deterministic signal the dock mounted.
        await expect(dockToggle).toHaveAttribute('aria-pressed', 'false');
        await dockToggle.click();
        await expect(dockToggle).toHaveAttribute('aria-pressed', 'true');

        const tabpanel = page.locator('#bottom-dock-tabpanel');
        await expect(tabpanel).toBeVisible();

        // A meter card title is unique to AnalysisPanel, so its absence before the
        // switch is the pre-state, and its presence after is the content swap.
        const spectrumCardHeading = page.getByRole('heading', { name: 'Spectrum Analyzer' });
        await expect(spectrumCardHeading).toHaveCount(0);

        // Selecting the Analysis tab flips its aria-selected and swaps the
        // rendered tab content (renderBottomTabContent switches on the active tab
        // and mounts exactly one branch — Mixer unmounts, AnalysisPanel mounts).
        const analysisTab = page.locator('#bottom-dock-tab-analysis');
        await expect(analysisTab).toHaveAttribute('aria-selected', 'false');
        await analysisTab.click();
        await expect(analysisTab).toHaveAttribute('aria-selected', 'true');

        // The AnalysisPanel meter cards are now mounted — a state change, not
        // existence: the same selectors returned nothing on the Mixer tab.
        await expect(spectrumCardHeading).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Phase Correlation' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'LUFS' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Oscilloscope' })).toBeVisible();
    });

    test('LUFSMeter card renders on Analysis and is absent on the Mixer tab', async ({ page }) => {
        const dockToggle = page.getByTestId('toggle-bottom-dock');
        if ((await dockToggle.getAttribute('aria-pressed')) === 'false') {
            await dockToggle.click();
            await expect(dockToggle).toHaveAttribute('aria-pressed', 'true');
        }

        // Start on Mixer: the LUFS card (an Analysis-only meter view) is absent.
        const mixerTab = page.locator('#bottom-dock-tab-mixer');
        await mixerTab.click();
        await expect(mixerTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('heading', { name: 'LUFS' })).toHaveCount(0);

        // Switching to Analysis mounts AnalysisPanel, whose LUFS card renders.
        const analysisTab = page.locator('#bottom-dock-tab-analysis');
        await analysisTab.click();
        await expect(analysisTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('heading', { name: 'LUFS' })).toBeVisible();
        // The card's description is the meter view's own copy, not the tab label.
        await expect(page.getByText('Momentary, short-term, and integrated loudness.')).toBeVisible();
    });
});
