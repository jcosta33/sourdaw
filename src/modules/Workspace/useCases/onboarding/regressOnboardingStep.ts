import { onboardingStore } from '../../stores/onboardingStore';

export const regressOnboardingStep = (): void => {
    const current = onboardingStore.value;
    if (!current || !current.active) {
        return;
    }
    const previous = Math.max(0, current.stepIndex - 1);
    onboardingStore.set({ active: true, stepIndex: previous });
};
