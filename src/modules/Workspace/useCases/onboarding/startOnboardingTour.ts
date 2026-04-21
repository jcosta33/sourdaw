import { onboardingStore } from '../../stores/onboardingStore';

export const startOnboardingTour = (): void => {
    onboardingStore.set({ active: true, stepIndex: 0 });
};
