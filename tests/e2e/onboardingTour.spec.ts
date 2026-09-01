import { test, expect, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { enable_direct_e2e_viewport, launch_new_project } from './e2eUtils';

/**
 * `setupWorkspace()` (see e2eUtils.ts) deliberately seeds
 * `wd:onboarding-completed` so unrelated specs never race the tour. This
 * harness intentionally omits that key to reproduce a genuine first-run
 * profile: only the alpha notice is pre-dismissed (it isn't what this spec
 * is about), so `AppShell`'s real auto-trigger effect — start the tour once
 * a project is initialized and has at least one track — fires for real. A
 * brand-new project already carries a "Master" track (see
 * `newProject.ts`), so the tour opens as soon as the workspace mounts, with
 * no bypass and no manual `startOnboardingTour()` call from the test.
 */
async function setup_fresh_onboarding_workspace(page: Page): Promise<void> {
    const alphaDismissed = superjsonStringify(true);

    await enable_direct_e2e_viewport(page);
    await page.addInitScript(
        ({ alphaDismissed: dismissed }) => {
            window.localStorage.clear();
            window.localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        },
        { alphaDismissed }
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
}

test.describe('Onboarding tour (fresh profile, no bypass)', () => {
    test.beforeEach(async ({ page }) => {
        await setup_fresh_onboarding_workspace(page);
        await launch_new_project(page);
    });

    test('An un-dismissed profile auto-starts the tour on its first step', async ({ page }) => {
        const tour = page.getByRole('dialog', { name: 'Onboarding tour' });
        await expect(tour).toBeVisible();
        await expect(tour.getByText('Step 1 of 10')).toBeVisible();
        await expect(tour.getByRole('heading', { name: 'Transport' })).toBeVisible();
        await expect(tour.getByRole('button', { name: 'Back' })).toBeDisabled();
    });

    test('Advancing the tour moves to the next step and back again', async ({ page }) => {
        const tour = page.getByRole('dialog', { name: 'Onboarding tour' });
        await expect(tour.getByRole('heading', { name: 'Transport' })).toBeVisible();

        await tour.getByRole('button', { name: 'Next' }).click();

        await expect(tour.getByRole('heading', { name: 'Track list' })).toBeVisible();
        await expect(tour.getByText('Step 2 of 10')).toBeVisible();
        await expect(tour.getByRole('button', { name: 'Back' })).toBeEnabled();

        await tour.getByRole('button', { name: 'Back' }).click();

        await expect(tour.getByRole('heading', { name: 'Transport' })).toBeVisible();
        await expect(tour.getByText('Step 1 of 10')).toBeVisible();
    });
});
