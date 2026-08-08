import { onboardingStore } from '../stores/onboardingStore';

import { markOnboardingCompleted } from './markOnboardingCompleted';

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
        // Advancing off the last step is a completion, not a pause: ArrowRight on
        // the final step lands here, and without the flag the tour auto-starts
        // again on every launch.
        onboardingStore.set({ active: false, stepIndex: 0 });
        markOnboardingCompleted();
        return;
    }
    onboardingStore.set({ active: true, stepIndex: next });
};
