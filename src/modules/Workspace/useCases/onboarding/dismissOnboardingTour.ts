import { onboardingStore } from '../../stores/onboardingStore';

import { ONBOARDING_COMPLETED_KEY } from './onboardingStorageKey';

export const dismissOnboardingTour = (): void => {
    onboardingStore.set({ active: false, stepIndex: 0 });
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
    }
};
