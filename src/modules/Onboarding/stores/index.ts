// Onboarding/stores — public read contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { onboardingStore, defaultOnboardingState } from './onboardingStore';
export type { OnboardingState } from './onboardingStore';
