import { expect, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

const LAUNCH_SCREEN_NAME = 'Sourdaw — start a project';
const PLAYBACK_CONTROLS_NAME = 'Playback controls';

type LaunchOverlayState = 'active' | 'exited';

type LaunchFromTemplateInput = {
    page: Page;
    template_name: string | RegExp;
};

/**
 * Common setup for E2E tests: bypasses the onboarding tour and alpha notice
 * via local storage, then navigates to the requested app path (root by default)
 * and ensures basic DOM loading is complete.
 */
export async function setupWorkspace(page: Page, path = '/'): Promise<void> {
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[Browser Error] ${err}`));

    // The alpha-notice flag is read through `createLocalStorage` (superjson),
    // so the value must be in superjson's serialized form for the store to
    // parse it as boolean `true`.
    const alphaDismissed = superjsonStringify(true);

    await page.addInitScript(({ alphaDismissed }) => {
        window.localStorage.clear();
        window.localStorage.setItem('wd:onboarding-completed', '1');
        window.localStorage.setItem('sourdaw-alpha-notice-dismissed', alphaDismissed);
    }, { alphaDismissed });

    await page.goto(path);
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
    await expect.poll(async () => get_launch_overlay_state(page)).toBe('exited');
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
