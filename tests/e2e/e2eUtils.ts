import { expect, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { DIRECT_E2E_VIEWPORT_NAME } from '../../src/app/resolveAppComposition';

export const LAUNCH_SCREEN_NAME = 'Sourdaw — start a project';
const PLAYBACK_CONTROLS_NAME = 'Playback controls';
/**
 * The launch overlay is the application's first paint, so it is bounded
 * independently of the suite ceiling: it admits a cold Vite transform while a
 * genuine hang still fails well before the multi-step allowance. Every spec
 * that waits on that overlay itself, rather than through the helpers below,
 * owes the same bound.
 */
export const LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS = 45_000;

/**
 * Storage keys this realm seeds or reads to steer first-run state. Each
 * restates a key the product owns — models constants must not cross module
 * boundaries, so the e2e realm keeps its own spelling next to a pointer:
 * alpha notice: `src/modules/WorkspaceShell/stores/alphaNoticeStore.ts`;
 * preferences: `src/modules/Preferences/stores/preferencesStore.ts`;
 * recent projects: `RECENT_PROJECTS_KEY` in
 * `src/modules/Project/models/ProjectData.ts`. The union in
 * `src/infra/store/storage/LocalStorageKeys.ts` inventories every key for the
 * cookie/localStorage policy, which is why these keys carry legal-visibility
 * weight on top of the round-trip one.
 */
const ALPHA_NOTICE_DISMISSED_STORAGE_KEY = 'sourdaw-alpha-notice-dismissed';
export const PREFERENCES_STORAGE_KEY = 'sourdaw-preferences';
export const RECENT_PROJECTS_STORAGE_KEY = 'sourdaw-recent-projects';

type LaunchOverlayState = 'active' | 'exited';

type LaunchFromTemplateInput = {
    page: Page;
    template_name: string | RegExp;
};

type LaunchNewProjectOptions = {
    firstPaintTimeoutMs?: number;
};

type SetupWorkspaceOptions = {
    localStorage?: Array<{ name: string; value: string }>;
};

/**
 * Existing E2E specs address the application through Playwright's Page fixture.
 * Keep that stable on either a reused development server or the e2e-mode server,
 * while the dedicated browser-display-scale spec exercises the production iframe
 * boundary directly.
 */
export async function enable_direct_e2e_viewport(page: Page): Promise<void> {
    // The page-scoped script covers this Page's first and later documents; the
    // context script covers subsequently created Pages and frames. The name
    // rides the argument channel: an init script's free variables do not
    // exist in the page realm, only its serialized body does.
    await page.addInitScript((viewportName: string) => {
        window.name = viewportName;
    }, DIRECT_E2E_VIEWPORT_NAME);
    await page.context().addInitScript((viewportName: string) => {
        window.name = viewportName;
    }, DIRECT_E2E_VIEWPORT_NAME);
}

/**
 * Common setup for E2E tests: bypasses the onboarding tour, alpha notice, and
 * delayed first-load shortcut hint via local storage, then navigates to the
 * root URL and ensures basic DOM loading is complete.
 */
export async function setupWorkspace(page: Page, options: SetupWorkspaceOptions = {}): Promise<void> {
    page.on('console', (msg) => console.log(`[Browser Console] ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[Browser Error] ${err}`));

    // The alpha-notice flag is read through `createLocalStorage` (superjson),
    // so the value must be in superjson's serialized form for the store to
    // parse it as boolean `true`.
    const alphaDismissed = superjsonStringify(true);

    await enable_direct_e2e_viewport(page);
    await page.addInitScript(
        ({ alphaDismissed, alphaNoticeKey, localStorage }) => {
            window.localStorage.clear();
            window.localStorage.setItem('wd:onboarding-completed', '1');
            window.localStorage.setItem(alphaNoticeKey, alphaDismissed);
            window.localStorage.setItem('wd:first-load-hint-shown', '1');
            for (const entry of localStorage) {
                window.localStorage.setItem(entry.name, entry.value);
            }
        },
        {
            alphaDismissed,
            alphaNoticeKey: ALPHA_NOTICE_DISMISSED_STORAGE_KEY,
            localStorage: options.localStorage ?? [],
        }
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
}

async function get_launch_overlay_state(page: Page): Promise<LaunchOverlayState> {
    const launch_screen = page.getByLabel(LAUNCH_SCREEN_NAME);

    return launch_screen.evaluateAll((elements): LaunchOverlayState => {
        const element = elements[0];
        if (!element) {
            return 'exited';
        }

        const style = window.getComputedStyle(element);
        if (style.opacity === '0' && style.pointerEvents === 'none') {
            return 'exited';
        }

        return 'active';
    });
}

export async function wait_for_workspace_ready(page: Page): Promise<void> {
    // Launch loading text is transient; wait for the stable exited-overlay contract instead.
    // The overlay-exit waits on WASM DSP boot + template instantiation. Under
    // full-suite worker contention a heavy template (e.g. the full demo project)
    // can take well past the 5s default poll bound; match the panel-open bound
    // so a slow-but-healthy boot is not mistaken for a hang.
    await expect.poll(async () => get_launch_overlay_state(page), { timeout: 30_000 }).toBe('exited');
    await expect(page.getByRole('group', { name: PLAYBACK_CONTROLS_NAME })).toBeVisible();
}

export async function launch_new_project(
    page: Page,
    { firstPaintTimeoutMs = LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS }: LaunchNewProjectOptions = {}
): Promise<void> {
    // Bounded independently of the suite ceiling: the overlay is the app's
    // first paint. It admits a cold Vite transform while a genuine hang still
    // fails before the multi-step allowance.
    await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: firstPaintTimeoutMs });

    await page.locator('#launch-new-project').click();
    await wait_for_workspace_ready(page);
}

export async function launch_from_template({ page, template_name }: LaunchFromTemplateInput): Promise<void> {
    // Same fast-fail bound as launch_new_project — see comment there.
    await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS });

    await page.locator('#launch-from-template').click();
    await expect(page.getByText('Start a new project')).toBeVisible();

    const template_button = page.getByRole('button', { name: template_name });
    await expect(template_button).toBeVisible({ timeout: 10_000 });
    await template_button.click();

    await wait_for_workspace_ready(page);
}

/**
 * Add a MIDI track from the empty arrangement's own empty-state button. A
 * fresh project starts with zero tracks (`createArrangement.ts`), so any spec
 * that needs a track-scoped control (e.g. the per-track arm button) must
 * create one first through this route or the command-palette equivalent.
 */
/**
 * Each wait carries its own budget so a slow boot fails loudly at the step that
 * is slow, instead of silently consuming the whole 90s test timeout here and
 * letting the spec's next locator (the arm button) absorb the expiry (#4299:
 * both record-toggle specs timed out at the arm click on CI's cold server while
 * passing locally against a warm one).
 */
const ADD_TRACK_STEP_TIMEOUT_MS = 15_000;

export async function add_midi_track(page: Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible', timeout: ADD_TRACK_STEP_TIMEOUT_MS });
    await emptyStateMidiButton.click({ timeout: ADD_TRACK_STEP_TIMEOUT_MS });
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await trackList
        .getByRole('row')
        .filter({ hasText: /MIDI/i })
        .first()
        .waitFor({ timeout: ADD_TRACK_STEP_TIMEOUT_MS });
}

const PANEL_OPEN_TIMEOUT_MS = 30_000;

type OpenBrowserInstrumentInput = {
    page: Page;
    /** The instrument card label, which is also its device-panel label. */
    instrument: string;
};

/**
 * Open an instrument's device panel from the Browser → Instruments tab, waiting
 * on the panel-mounted contract instead of a fixed sleep.
 *
 * Clicking an instrument card creates the track + device and mounts the
 * InstrumentBottomPanel. Under full-suite worker contention that mount can take
 * several seconds, so a hard `waitForTimeout` before asserting the panel's inner
 * controls flakes (the panel is not up yet at the fixed deadline). The card label
 * doubles as the panel label, so the panel's `Close <instrument>` control is a
 * uniform "panel is mounted" signal. Callers then assert the panel's own controls
 * with the default timeout, since by then the panel is present.
 */
export async function open_browser_instrument({ page, instrument }: OpenBrowserInstrumentInput): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    // The InstrumentCard is a real <button> (DawChooserCard) whose accessible
    // name begins with the instrument label, e.g. "Levain Orchestra …". Target it
    // by role + name-prefix, not a bare getByText: a text-node click can resolve
    // to a stray same-text node (a preset row, a prompt-context chip) under a
    // render race, whereas the card button is unambiguous.
    await browser.getByRole('button', { name: new RegExp(`^${instrument}`) }).click();
    await expect(page.getByRole('button', { name: `Close ${instrument}` })).toBeVisible({
        timeout: PANEL_OPEN_TIMEOUT_MS,
    });
}
