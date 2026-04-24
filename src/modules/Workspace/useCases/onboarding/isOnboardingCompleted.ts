import { ONBOARDING_COMPLETED_KEY } from './onboardingStorageKey';

export const isOnboardingCompleted = (): boolean => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return true;
    }
    return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === '1';
};
