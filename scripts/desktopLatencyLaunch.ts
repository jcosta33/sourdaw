/**
 * Getting the packaged app from a cold, isolated profile to a project it can
 * be driven in — either the launch screen, or (for a future profile that
 * skips it) a restored workspace — and past the launch screen's own exit
 * animation once a new project has been requested.
 *
 * Split out of `measureDesktopLatency.ts` to keep that driver under the
 * repository's per-file line budget; these helpers still drive a live
 * `Page`, so — like that driver, and unlike `desktopLatencyReadings.ts` —
 * this file is not unit-testable without Playwright.
 */

import { type Page } from 'playwright';

import { describeElementAtCentre } from './desktopLatencyDiagnostics.ts';
import { type AppStartedAt } from './desktopLatencyRecord.ts';

/** `LaunchScreen.tsx` — the button that starts a new, empty project. */
const LAUNCH_NEW_PROJECT_SELECTOR = '#launch-new-project';
/** `AppShell.tsx` — the status bar footer. It mounts underneath the launch overlay once the workspace exists. */
const STATUS_BAR_SELECTOR = 'footer[aria-label="Application status"]';
/** `LaunchScreen.tsx` — the overlay that covers the workspace until a project is ready. */
const LAUNCH_OVERLAY_SELECTOR = '[role="dialog"][aria-label="Sourdaw — start a project"]';
/** The overlay's own exit transition is 700 ms; two polls this far apart tell a real unmount from a render gap. */
const OVERLAY_ABSENCE_POLL_MS = 500;
/** `OnboardingTour.tsx` — the first-run tour overlay and its own dismiss control. */
const ONBOARDING_TOUR_SELECTOR = '[role="dialog"][aria-label="Onboarding tour"]';
const SKIP_TOUR_BUTTON_NAME = 'Skip tour';
/** `Sidebar.tsx` — the browser panel's own tab bar, scoped inside `[aria-label="Browser panel"]`. */
const BROWSER_PANEL_SELECTOR = '[aria-label="Browser panel"]';
const EFFECTS_TAB_BUTTON_NAME = 'Effects';
/** Traced on #3070: the tab bar mounts seconds after the panel container does, so this polls faster than the overlay checks above. */
const TOUR_POLL_MS = 250;

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The workspace renders beneath the launch overlay, so the status bar can
 * exist in the DOM while the overlay still covers the whole app. Returning
 * "gone" on a single absent reading would race the overlay's own 700 ms exit
 * transition (opacity, then unmount); two consecutive absent polls 500 ms
 * apart is what tells a genuine unmount from a transient gap between two
 * renders that both still have it mounted.
 */
export async function waitUntilOverlayGone(page: Page, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let consecutiveAbsent = 0;
    while (Date.now() < deadline) {
        const present = (await page.locator(LAUNCH_OVERLAY_SELECTOR).count()) > 0;
        consecutiveAbsent = present ? 0 : consecutiveAbsent + 1;
        if (consecutiveAbsent >= 2) {
            return;
        }
        await sleep(OVERLAY_ABSENCE_POLL_MS);
    }
    throw new Error(`the launch overlay did not leave the DOM within ${timeoutMs} ms`);
}

/**
 * The packaged app does not always land on the launch screen: a restored
 * workspace opens straight to the status bar. `#launch-new-project` is
 * checked first, on every poll, regardless of whether the status bar is
 * already present.
 *
 * Cold boot on the isolated profile this harness always launches against
 * runs `ProjectLoadingOverlay` first — a *different* full-screen overlay,
 * shown while `project.loading` is still `true` (Faust WASM compilation,
 * device creation, audio graph wiring) — before `project.loading` ever
 * flips to `false` and the real launch screen (`LAUNCH_OVERLAY_SELECTOR`)
 * gets a chance to mount. During that phase the status bar footer is
 * already in the DOM (it belongs to the persistent shell) while *neither*
 * `#launch-new-project` nor the launch overlay exist yet — so treating a
 * status-bar sighting plus a couple of absent-overlay polls as "workspace"
 * reads a not-yet-arrived launch screen as a finished boot. There is no
 * signal that distinguishes "the launch screen will never come" from "the
 * launch screen hasn't been able to mount yet", so `workspace` is never
 * inferred from a shortcut: this polls for `#launch-new-project` for the
 * entire timeout and only falls back to `workspace` at the very end, once
 * the deadline is reached with the status bar present and no overlay
 * showing. A future profile that skips the launch screen entirely still
 * resolves — just after paying out the full timeout once, which the
 * profile being fixed at `'isolated'` for now makes an acceptable cost.
 * Which branch this run took is recorded rather than inferred, because a
 * baseline that guessed wrong here would silently skip or misplace the
 * "new project" click.
 */
export async function waitForWorkspaceOrLaunchScreen(page: Page, timeoutMs: number): Promise<AppStartedAt> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await page.locator(LAUNCH_NEW_PROJECT_SELECTOR).count()) > 0) {
            return 'launch-screen';
        }
        await sleep(OVERLAY_ABSENCE_POLL_MS);
    }
    const statusBarPresent = (await page.locator(STATUS_BAR_SELECTOR).count()) > 0;
    const overlayPresent = (await page.locator(LAUNCH_OVERLAY_SELECTOR).count()) > 0;
    if (statusBarPresent && !overlayPresent) {
        return 'workspace';
    }
    throw new Error('neither the workspace status bar nor the launch screen appeared');
}

/** Clicks "New Project" and waits out the overlay's own exit animation before returning. */
export async function openNewProjectFromLaunchScreen(page: Page, timeoutMs: number): Promise<void> {
    await page.locator(LAUNCH_NEW_PROJECT_SELECTOR).click({ timeout: timeoutMs });
    await waitUntilOverlayGone(page, timeoutMs);
}

/**
 * On a fresh, isolated profile the sidebar's own tab bar — and its "Effects"
 * button — mounts a few seconds after the browser panel container is already
 * visible, and the first-run onboarding tour then spotlights that tab bar
 * before the driver ever gets to click it (traced on #3070: `elementFromPoint`
 * at the Effects button's centre resolved to `[role="dialog"][aria-label="Onboarding
 * tour"]` for several seconds after the button existed). The harness measures
 * audio, not onboarding, so this dismisses the tour the moment it appears and
 * otherwise returns as soon as the Effects button exists — on a profile where
 * the tour never shows, that is the only condition this waits for.
 */
export async function dismissOnboardingTour(page: Page, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const tour = page.locator(ONBOARDING_TOUR_SELECTOR);
        if ((await tour.count()) > 0) {
            await tour.getByRole('button', { name: SKIP_TOUR_BUTTON_NAME, exact: true }).click({ timeout: timeoutMs });
            await tour.waitFor({ state: 'detached', timeout: timeoutMs });
            return;
        }
        const effectsButtonPresent =
            (await page
                .locator(BROWSER_PANEL_SELECTOR)
                .getByRole('button', { name: EFFECTS_TAB_BUTTON_NAME, exact: true })
                .count()) > 0;
        if (effectsButtonPresent) {
            return;
        }
        await sleep(TOUR_POLL_MS);
    }
    throw new Error(`neither the onboarding tour nor the Effects tab button appeared within ${timeoutMs} ms`);
}

/**
 * Traced on #3070: the onboarding tour dismissed above can advance to a
 * later step on its own and re-cover the same point a moment later, so a
 * click that already raced it once can race it again. One retry — dismiss
 * whatever tour is showing now, click once more — is enough because the
 * tour has nowhere else to go after its dialog leaves the DOM a second time;
 * a click that still fails after that is a different problem, and the
 * failure names what was actually at the button's centre instead of just
 * "timed out".
 */
export async function openEffectsTab(page: Page, timeoutMs: number): Promise<void> {
    const effectsButton = page.locator(BROWSER_PANEL_SELECTOR).getByRole('button', {
        name: EFFECTS_TAB_BUTTON_NAME,
        exact: true,
    });
    // Not `[aria-label="Rescan plugins"]`: that button only exists in
    // `PluginBrowser`'s `supportedPlugins.length > 0` branch, and a fresh
    // launch never reaches it. The "External Plugins" eyebrow label sits
    // outside every scan-state branch, so it proves the panel mounted
    // regardless of scan state.
    const externalPluginsLabel = page.locator(BROWSER_PANEL_SELECTOR).getByText('External Plugins', { exact: true });

    await effectsButton.click({ timeout: timeoutMs });
    try {
        await externalPluginsLabel.waitFor({ state: 'visible', timeout: timeoutMs });
        return;
    } catch {
        // Falls through to the one retry below.
    }

    await dismissOnboardingTour(page, timeoutMs);
    await effectsButton.click({ timeout: timeoutMs });
    try {
        await externalPluginsLabel.waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
        const box = await effectsButton.boundingBox();
        const atCentre = box === null ? 'no bounding box' : await describeElementAtCentre(page, box);
        throw new Error(
            `"External Plugins" never appeared after two clicks on the Effects tab — at its centre: ${atCentre}`
        );
    }
}
