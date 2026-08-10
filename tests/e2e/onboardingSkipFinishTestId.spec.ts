import { test, expect, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { launch_new_project } from './e2eUtils';

// Mirrors onboardingTour.spec.ts: omit the onboarding-completed key so the tour
// auto-starts on a fresh profile, exercising the real auto-trigger.
async function setup_fresh_onboarding_workspace(page: Page): Promise<void> {
    const alphaDismissed = superjsonStringify(true);
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

// Onboarding tour dismissal: the existing spec covers start + step nav, but not
// the two dismiss paths — "Skip tour" (any step) and "Finish" (the last step's
// Next). Both call dismissOnboardingTour, removing the tour dialog.
test.describe('Onboarding tour — skip and finish dismiss the tour', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setup_fresh_onboarding_workspace(page);
        await launch_new_project(page);
    });

    test('Skip tour dismisses the tour dialog from the first step', async ({ page }) => {
        const tour = page.getByRole('dialog', { name: 'Onboarding tour' });
        await expect(tour).toBeVisible();

        await tour.getByRole('button', { name: 'Skip tour' }).click();

        // The tour dialog is gone — a real dismissal, not a step advance.
        await expect(tour).toHaveCount(0);
    });

    test('Finish on the last step dismisses the tour', async ({ page }) => {
        const tour = page.getByRole('dialog', { name: 'Onboarding tour' });
        await expect(tour).toBeVisible();

        // Advance to the last step (Step 10 of 10). Next relabels to Finish there.
        for (let i = 0; i < 9; i += 1) {
            await tour.getByRole('button', { name: 'Next' }).click();
            await page.waitForTimeout(100);
        }
        await expect(tour.getByText('Step 10 of 10')).toBeVisible();

        // The last step's Next is labelled Finish; clicking it dismisses the tour.
        await tour.getByRole('button', { name: 'Finish' }).click();
        await expect(tour).toHaveCount(0);
    });
});
