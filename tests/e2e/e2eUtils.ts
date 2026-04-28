import { type Page } from '@playwright/test';

/**
 * Common setup for E2E tests: bypasses the onboarding tour, audio resume overlays,
 * and alpha notices via local storage, then navigates to the root URL and ensures
 * basic DOM loading is complete.
 */
export async function setupWorkspace(page: Page): Promise<void> {
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[Browser Error] ${err}`));

    await page.addInitScript(() => {
        window.localStorage.setItem('wd:onboarding-completed', '1');
        window.localStorage.setItem('wd:audio-resume-dismissed', '1');
        window.localStorage.setItem('sourdaw-alpha-notice-dismissed', 'true');
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
}
