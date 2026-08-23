import { expect, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

const LAUNCH_SCREEN_NAME = 'Sourdaw — start a project';
const PLAYBACK_CONTROLS_NAME = 'Playback controls';

type LaunchOverlayState = 'active' | 'exited';

type LaunchFromTemplateInput = {
    page: Page;
    template_name: string | RegExp;
};

type SetupWorkspaceOptions = {
    e2eWebLlmAdmission?: boolean;
    localStorage?: Array<{ name: string; value: string }>;
};

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

    await page.addInitScript(
        ({ alphaDismissed, e2eWebLlmAdmission, localStorage }) => {
            window.localStorage.clear();
            window.localStorage.setItem('wd:onboarding-completed', '1');
            window.localStorage.setItem('sourdaw-alpha-notice-dismissed', alphaDismissed);
            window.localStorage.setItem('wd:first-load-hint-shown', '1');
            for (const entry of localStorage) {
                window.localStorage.setItem(entry.name, entry.value);
            }
            if (e2eWebLlmAdmission) {
                Reflect.set(window, '__SOURDAW_E2E_WEBLLM_ADMITTED__', true);
                if (!('gpu' in navigator)) {
                    Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} });
                }
            }
        },
        {
            alphaDismissed,
            e2eWebLlmAdmission: options.e2eWebLlmAdmission ?? false,
            localStorage: options.localStorage ?? [],
        }
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
}

/**
 * Starts the app with the E2E-only local provider fixture admitted. The test
 * mode gate in modelReleaseAdmission keeps this unavailable in product builds.
 */
export async function setupAdmittedWebLlmWorkspace(page: Page): Promise<void> {
    await setupWorkspace(page, { e2eWebLlmAdmission: true });
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

export async function launch_new_project(page: Page): Promise<void> {
    // Bounded independently of the 60s suite ceiling: the overlay is the app's
    // first paint, so a genuine hang here should fail fast, not ride the slow
    // multi-step allowance.
    await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 15_000 });

    await page.locator('#launch-new-project').click();
    await wait_for_workspace_ready(page);
}

export async function launch_from_template({ page, template_name }: LaunchFromTemplateInput): Promise<void> {
    // Same fast-fail bound as launch_new_project — see comment there.
    await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 15_000 });

    await page.locator('#launch-from-template').click();
    await expect(page.getByText('Start a new project')).toBeVisible();

    const template_button = page.getByRole('button', { name: template_name });
    await expect(template_button).toBeVisible({ timeout: 10_000 });
    await template_button.click();

    await wait_for_workspace_ready(page);
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
