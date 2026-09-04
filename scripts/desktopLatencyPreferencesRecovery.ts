/**
 * Preferences-dialog recovery for a harness plugin candidate the scan store
 * has quarantined.
 *
 * A machine that ever scanned a build carrying #3488's defect (the leaf
 * worker never ran, every candidate "timed out") holds a persisted
 * quarantine record for the harness plugin, and an ordinary scan skips a
 * quarantined candidate forever by design (AC-002). The product's only route
 * back is the Preferences dialog's "Retry Quarantined" button, so a first
 * scan that did not list the plugin is routed there before the driver's
 * "find" step gives up on it.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; these helpers still drive a live
 * `Page`, so — like that driver, and unlike `desktopLatencyReadings.ts` —
 * this file is not unit-testable without Playwright.
 */

import { type Page } from 'playwright';

import { findQuarantineReason, type QuarantinedEntry } from './desktopLatencyReadings.ts';
import { sleep } from './desktopLatencySleep.ts';

/** `PanelToggles.tsx` — the toolbar button that opens the Preferences dialog at its normal width. */
const OPEN_PREFERENCES_SELECTOR = '[aria-label="Open Preferences"]';

/**
 * `PanelToggles.tsx`'s `compact` branch — used once the transport bar is too
 * narrow for its full button row — replaces the icon button above with a
 * "View and panel controls" popover trigger, inside which "Preferences" is a
 * plain text button with no `aria-label` of its own.
 */
const VIEW_AND_PANEL_CONTROLS_TRIGGER_NAME = 'View and panel controls';
const COMPACT_PREFERENCES_BUTTON_NAME = 'Preferences';

/** `PluginScanSettings.tsx` — its "Retry Quarantined" button and its scan-trigger button's "scanning" text. */
const RETRY_QUARANTINED_BUTTON_NAME = 'Retry Quarantined';
const PREFERENCES_SCANNING_BUTTON_NAME = 'Scanning...';

/**
 * Opens Preferences from whichever toolbar shape is showing. A narrow
 * transport bar collapses `[aria-label="Open Preferences"]` behind the
 * "View and panel controls" popover, so the direct button is tried first and
 * the popover route only runs when it is absent — mirroring how
 * `clickPluginScanTrigger` in `measureDesktopLatency.ts` picks between the
 * scan trigger's two shapes.
 */
async function openPreferencesFromToolbar(page: Page, stepTimeoutMs: number): Promise<void> {
    const directButton = page.locator(OPEN_PREFERENCES_SELECTOR);
    if ((await directButton.count()) > 0) {
        await directButton.click({ timeout: stepTimeoutMs });
        return;
    }
    await page
        .getByRole('button', { name: VIEW_AND_PANEL_CONTROLS_TRIGGER_NAME, exact: true })
        .click({ timeout: stepTimeoutMs });
    await page
        .getByRole('button', { name: COMPACT_PREFERENCES_BUTTON_NAME, exact: true })
        .click({ timeout: stepTimeoutMs });
}

/**
 * `PreferencesDialog.tsx` navigates by clicking a sidebar item, and
 * `PluginScanSettings.tsx` — the "Plugin Paths" section — only mounts once
 * the "Audio" item is selected. Opening the dialog is not enough on its own:
 * a fresh dialog always lands on "General".
 */
async function openPreferencesOnAudioSection(page: Page, stepTimeoutMs: number): Promise<void> {
    await openPreferencesFromToolbar(page, stepTimeoutMs);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Audio', exact: true }).click({ timeout: stepTimeoutMs });
    await dialog.getByText('Plugin Paths', { exact: true }).waitFor({ state: 'visible', timeout: stepTimeoutMs });
}

async function closePreferences(page: Page, stepTimeoutMs: number): Promise<void> {
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: stepTimeoutMs });
}

/**
 * Reads the quarantine block's own rows rather than the plugin-scan-paths
 * list above it, which also carries `span[title]` entries: the quarantine
 * block is found first, by the "N quarantined" badge text next to it, and
 * only its own `span[title]` children are read.
 *
 * `closest` is called from the badge's parent, not the badge itself: the
 * badge span's own class carries `accent-peach` too (its border and
 * background colour), so starting `closest` on the badge would match the
 * badge and never climb to the block that actually holds the entries.
 */
async function readQuarantinedEntries(page: Page): Promise<QuarantinedEntry[]> {
    return page.getByRole('dialog').evaluate((dialog) => {
        const badge = [...dialog.querySelectorAll('span')].find((span) =>
            /^\d+ quarantined$/.test(span.textContent?.trim() ?? '')
        );
        const block = badge?.parentElement?.closest('[class*="accent-peach"]');
        if (block === null || block === undefined) {
            return [];
        }
        return [...block.querySelectorAll('span[title]')].map((span) => ({
            path: span.textContent?.trim() ?? '',
            reason: span.getAttribute('title') ?? '',
        }));
    });
}

/**
 * `PluginScanSettings.tsx`'s scan-trigger button reads "Scanning..." only
 * while `state.isScanning`, so waiting for it to stop reading that is what
 * the product itself uses to mean "the scan finished".
 */
async function waitForPreferencesScanToFinish(page: Page, scanStepTimeoutMs: number): Promise<void> {
    const scanningButton = page
        .getByRole('dialog')
        .getByRole('button', { name: PREFERENCES_SCANNING_BUTTON_NAME, exact: true });
    await scanningButton.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {
        // Not seen within 2 s: either the scan already finished, or the click
        // never started one. Either way the poll below decides, not this wait.
    });

    const startedAt = Date.now();
    const deadline = startedAt + scanStepTimeoutMs;
    while (Date.now() < deadline) {
        if ((await scanningButton.count()) === 0) {
            return;
        }
        await sleep(500);
    }
    throw new Error(`the preferences plugin scan did not finish within ${scanStepTimeoutMs} ms`);
}

async function retryQuarantinedScan(page: Page, stepTimeoutMs: number, scanStepTimeoutMs: number): Promise<void> {
    await page
        .getByRole('dialog')
        .getByRole('button', { name: RETRY_QUARANTINED_BUTTON_NAME, exact: true })
        .click({ timeout: stepTimeoutMs });
    await waitForPreferencesScanToFinish(page, scanStepTimeoutMs);
}

export type QuarantineRecoveryTimeouts = { stepTimeoutMs: number; scanStepTimeoutMs: number };

export async function recoverQuarantinedHarnessPlugin(
    page: Page,
    harnessPluginName: string,
    harnessPluginPath: string,
    timeouts: QuarantineRecoveryTimeouts
): Promise<void> {
    if ((await page.getByText(harnessPluginName, { exact: true }).count()) > 0) {
        process.stdout.write('harness plugin listed after the first scan\n');
        return;
    }

    await openPreferencesOnAudioSection(page, timeouts.stepTimeoutMs);
    const reason = findQuarantineReason(await readQuarantinedEntries(page), harnessPluginPath);

    if (reason === null) {
        await closePreferences(page, timeouts.stepTimeoutMs);
        return;
    }

    process.stdout.write(`harness plugin quarantined: "${reason}" — retrying\n`);
    await retryQuarantinedScan(page, timeouts.stepTimeoutMs, timeouts.scanStepTimeoutMs);
    await closePreferences(page, timeouts.stepTimeoutMs);
}
