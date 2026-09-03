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
import { sleep } from './desktopLatencySleep.ts';

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
/** `AlphaNoticeDialog.tsx` — the dialog carries no accessible name (see `dismissAlphaNotice`), so its dismiss control is what this polls for. */
const ALPHA_NOTICE_DISMISS_NAME = 'Let me cook';
/** Long enough for `AlphaNoticeDialog` to have mounted after the project is ready, if it was going to at all. */
const ALPHA_NOTICE_GRACE_MS = 3_000;
/** Faster than the overlay-absence checks above: these two first-run screens are traced to appear within a couple of seconds, not the launch overlay's slower exit transition. */
const TOUR_POLL_MS = 250;

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
 * `AppShell.tsx` opens `AlphaNoticeDialog` as soon as `project.initialized &&
 * !alphaDismissed` — right after a fresh profile's first project is created —
 * and does not start the onboarding tour until it closes. `AlphaNoticeDialog`
 * renders a plain `<h2>`, not Radix's own `DialogTitle`, so `DialogContent`
 * never gets a `titlePresent` context value and never sets `aria-labelledby`:
 * the dialog carries no accessible name to poll `[role="dialog"]` by. Its
 * "Let me cook" dismiss control is unique in the app and exists only while
 * the dialog is mounted, so that is what this polls for instead. A profile
 * that already dismissed the notice (persisted `alphaNoticeStore` state)
 * never shows it again — `ALPHA_NOTICE_GRACE_MS` after this step starts is
 * long enough for the dialog to have mounted if it was going to, so once
 * that passes without it appearing and the Effects tab button is already
 * reachable, this returns instead of waiting out the rest of `timeoutMs`.
 */
export async function dismissAlphaNotice(page: Page, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
        const dismissButton = page.getByRole('button', { name: ALPHA_NOTICE_DISMISS_NAME, exact: true });
        if ((await dismissButton.count()) > 0) {
            await dismissButton.click({ timeout: timeoutMs });
            await dismissButton.waitFor({ state: 'detached', timeout: timeoutMs });
            return;
        }
        if (Date.now() - startedAt >= ALPHA_NOTICE_GRACE_MS) {
            const effectsButtonPresent =
                (await page
                    .locator(BROWSER_PANEL_SELECTOR)
                    .getByRole('button', { name: EFFECTS_TAB_BUTTON_NAME, exact: true })
                    .count()) > 0;
            if (effectsButtonPresent) {
                return;
            }
        }
        await sleep(TOUR_POLL_MS);
    }
    throw new Error(`neither the alpha notice nor the Effects tab button appeared within ${timeoutMs} ms`);
}

/**
 * `AppShell.tsx` does not start the onboarding tour until the alpha notice
 * above closes and the track count is greater than zero, so the step above
 * running first is what lets this one find the tour promptly rather than
 * racing its own dialog for pointer events at the Effects button's centre
 * (traced on #3070: `elementFromPoint` there resolved to
 * `[role="dialog"][aria-label="Onboarding tour"]`, not the button, while the
 * alpha notice — not a mount delay — was still blocking it). The harness
 * measures audio, not onboarding, so this dismisses the tour the moment it
 * appears and otherwise returns as soon as the Effects button exists — on a
 * profile where the tour never shows, that is the only condition this waits
 * for.
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
