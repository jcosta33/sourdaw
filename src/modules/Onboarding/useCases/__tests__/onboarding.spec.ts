import { describe, it, expect, beforeEach } from 'vitest';

import { onboardingStore } from '../../stores/onboardingStore';
import { advanceOnboardingStep } from '../advanceOnboardingStep';
import { dismissOnboardingTour } from '../dismissOnboardingTour';
import { isOnboardingCompleted } from '../isOnboardingCompleted';
import { ONBOARDING_COMPLETED_KEY } from '../onboardingStorageKey';
import { regressOnboardingStep } from '../regressOnboardingStep';
import { startOnboardingTour } from '../startOnboardingTour';

describe('onboarding useCases', () => {
    beforeEach(() => {
        window.localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
        onboardingStore.set({ active: false, stepIndex: 0 });
    });

    it('startOnboardingTour activates the store at step 0', () => {
        startOnboardingTour();
        expect(onboardingStore.value).toEqual({ active: true, stepIndex: 0 });
    });

    it('advanceOnboardingStep increments and stops at total steps', () => {
        startOnboardingTour();
        advanceOnboardingStep({ totalSteps: 3 });
        expect(onboardingStore.value).toEqual({ active: true, stepIndex: 1 });
        advanceOnboardingStep({ totalSteps: 3 });
        expect(onboardingStore.value).toEqual({ active: true, stepIndex: 2 });
        advanceOnboardingStep({ totalSteps: 3 });
        expect(onboardingStore.value).toEqual({ active: false, stepIndex: 0 });
    });

    it('advanceOnboardingStep past the last step persists completion', () => {
        startOnboardingTour();
        advanceOnboardingStep({ totalSteps: 2 });
        expect(isOnboardingCompleted()).toBe(false);

        advanceOnboardingStep({ totalSteps: 2 });

        expect(onboardingStore.value).toEqual({ active: false, stepIndex: 0 });
        expect(window.localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('1');
        expect(isOnboardingCompleted()).toBe(true);
    });

    it('advanceOnboardingStep does not persist completion mid-tour', () => {
        startOnboardingTour();

        advanceOnboardingStep({ totalSteps: 3 });

        expect(window.localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeNull();
        expect(isOnboardingCompleted()).toBe(false);
    });

    it('regressOnboardingStep clamps at zero', () => {
        startOnboardingTour();
        advanceOnboardingStep({ totalSteps: 5 });
        advanceOnboardingStep({ totalSteps: 5 });
        expect(onboardingStore.value?.stepIndex).toBe(2);
        regressOnboardingStep();
        expect(onboardingStore.value?.stepIndex).toBe(1);
        regressOnboardingStep();
        regressOnboardingStep();
        expect(onboardingStore.value?.stepIndex).toBe(0);
    });

    it('dismissOnboardingTour deactivates the store and sets localStorage', () => {
        startOnboardingTour();
        dismissOnboardingTour();
        expect(onboardingStore.value).toEqual({ active: false, stepIndex: 0 });
        expect(window.localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('1');
    });

    it('isOnboardingCompleted reads the persisted flag', () => {
        expect(isOnboardingCompleted()).toBe(false);
        window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
        expect(isOnboardingCompleted()).toBe(true);
    });

    it('regressOnboardingStep does nothing while the tour is inactive', () => {
        regressOnboardingStep();
        expect(onboardingStore.value).toEqual({ active: false, stepIndex: 0 });
    });

    it('advanceOnboardingStep does nothing while the tour is inactive', () => {
        advanceOnboardingStep({ totalSteps: 3 });
        expect(onboardingStore.value).toEqual({ active: false, stepIndex: 0 });
    });

    it('isOnboardingCompleted treats a missing localStorage as completed', () => {
        const browserStorage = window.localStorage;
        Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined });

        try {
            expect(isOnboardingCompleted()).toBe(true);
        } finally {
            Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage });
        }
    });
});
