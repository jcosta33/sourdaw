import { onboardingStore } from '../../stores/onboardingStore';

export type AdvanceOnboardingStepInput = {
    totalSteps: number;
};

export const advanceOnboardingStep = ({ totalSteps }: AdvanceOnboardingStepInput): void => {
    const current = onboardingStore.value;
    if (!current || !current.active) {
        return;
    }
    const next = current.stepIndex + 1;
    if (next >= totalSteps) {
        onboardingStore.set({ active: false, stepIndex: 0 });
        return;
    }
    onboardingStore.set({ active: true, stepIndex: next });
};
