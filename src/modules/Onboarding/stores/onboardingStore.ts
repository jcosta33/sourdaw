import { createStore } from '#/infra/store/createStore';

export type OnboardingState = {
    active: boolean;
    stepIndex: number;
};

export const defaultOnboardingState: OnboardingState = {
    active: false,
    stepIndex: 0,
};

export const onboardingStore = createStore<OnboardingState>({
    initialData: defaultOnboardingState,
});
