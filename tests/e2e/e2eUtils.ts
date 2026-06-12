import { type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

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
