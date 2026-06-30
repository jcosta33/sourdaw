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
 * via local storage, then navigates to the root URL and ensures basic DOM
 * loading is complete.
 */
export async function setupWorkspace(page: Page): Promise<void> {
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
    await expect.poll(async () => get_launch_overlay_state(page)).toBe('exited');
    await expect(page.getByRole('group', { name: PLAYBACK_CONTROLS_NAME })).toBeVisible();
}

export async function launch_new_project(page: Page): Promise<void> {
    const launch_screen = page.getByLabel(LAUNCH_SCREEN_NAME);
    await launch_screen.waitFor({ state: 'visible' });

    await page.locator('#launch-new-project').click();
    await wait_for_workspace_ready(page);
}

export async function launch_from_template({ page, template_name }: LaunchFromTemplateInput): Promise<void> {
    const launch_screen = page.getByLabel(LAUNCH_SCREEN_NAME);
    await launch_screen.waitFor({ state: 'visible' });

    await page.locator('#launch-from-template').click();
    await expect(page.getByText('Start a new project')).toBeVisible();

    const template_button = page.getByRole('button', { name: template_name });
    await template_button.waitFor({ state: 'visible' });
    await template_button.click();

    await wait_for_workspace_ready(page);
}
