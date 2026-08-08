import { ONBOARDING_COMPLETED_KEY } from './onboardingStorageKey';

/**
 * Persist the "this profile has seen the tour" flag.
 *
 * Every path that ends the tour must go through here. `isOnboardingCompleted`
 * is what `AppShell` consults to decide whether to auto-start the tour, so a
 * termination path that only clears the store re-runs the tour on every launch.
 */
export const markOnboardingCompleted = (): void => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
};
