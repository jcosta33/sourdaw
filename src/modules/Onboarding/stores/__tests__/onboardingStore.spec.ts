import { describe, it, expect, beforeEach } from 'vitest';

import { defaultOnboardingState, onboardingStore, type OnboardingState } from '../onboardingStore';

describe('onboardingStore defaults', () => {
    beforeEach(() => {
        onboardingStore.set(defaultOnboardingState);
    });

    it('seeds an inactive tour at step zero', () => {
        expect(defaultOnboardingState).toEqual({ active: false, stepIndex: 0 });
        expect(onboardingStore.value).toEqual(defaultOnboardingState);
    });
});

describe('onboardingStore writes', () => {
    beforeEach(() => {
        onboardingStore.set(defaultOnboardingState);
    });

    it('reads back a full state written with set', () => {
        const started: OnboardingState = { active: true, stepIndex: 3 };

        onboardingStore.set(started);

        expect(onboardingStore.value).toEqual(started);
    });

    it('advances stepIndex via update without touching active', () => {
        onboardingStore.set({ active: true, stepIndex: 1 });

        onboardingStore.update((current) => ({
            ...(current ?? defaultOnboardingState),
            stepIndex: (current?.stepIndex ?? 0) + 1,
        }));

        expect(onboardingStore.value?.stepIndex).toBe(2);
        expect(onboardingStore.value?.active).toBe(true);
    });

    it('ends the tour by resetting to the default state', () => {
        onboardingStore.set({ active: true, stepIndex: 5 });

        onboardingStore.set(defaultOnboardingState);

        expect(onboardingStore.value).toEqual({ active: false, stepIndex: 0 });
    });
});

describe('onboardingStore subscribe/clear', () => {
    beforeEach(() => {
        onboardingStore.set(defaultOnboardingState);
    });

    it('notifies subscribers on set and stops after unsubscribe', () => {
        const seen: (OnboardingState | null)[] = [];
        const unsubscribe = onboardingStore.subscribe((value) => {
            seen.push(value);
        });

        onboardingStore.set({ active: true, stepIndex: 0 });
        unsubscribe();
        onboardingStore.set({ active: true, stepIndex: 1 });

        expect(seen).toHaveLength(1);
        expect(seen[0]?.active).toBe(true);
        expect(seen[0]?.stepIndex).toBe(0);
    });

    it('clears back to null', () => {
        onboardingStore.set({ active: true, stepIndex: 2 });

        onboardingStore.clear();

        expect(onboardingStore.value).toBeNull();
    });
});
