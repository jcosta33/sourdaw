import { onboardingStore } from '../stores/onboardingStore';

import { markOnboardingCompleted } from './markOnboardingCompleted';

export const dismissOnboardingTour = (): void => {
    onboardingStore.set({ active: false, stepIndex: 0 });
    markOnboardingCompleted();
};
