# Onboarding module — Agent Guidelines

First-time user tour progression, step navigation, spotlight UI target highlighting, and onboarding completion state persistence (project creation belongs to Project; help guides belong to Workspace).

## Public Contract Surface

- `stores`: `onboardingStore`, `defaultOnboardingState`, `OnboardingState`.
- `useCases`: `startOnboardingTour`, `advanceOnboardingStep`, `regressOnboardingStep`, `dismissOnboardingTour`, `isOnboardingCompleted`.
- `presentations/views`: `OnboardingTour`.

## Key Subsystems

- **Tour State Store**: Manages current active step index, total steps, spotlight targets, and tour visibility (`stores/onboardingStore.ts`).
- **Step Transitions**: `useCases/` (`startOnboardingTour`, `advanceOnboardingStep`, `regressOnboardingStep`, `dismissOnboardingTour`, `isOnboardingCompleted`).
- **Tour Presentation**: Modal/popover overlay displaying guided workflow tooltips anchored to workspace elements (`presentations/views/OnboardingTour.tsx`).

## Invariants & Traps

- **Completion Persistence**: Tour completion is stored in `localStorage` (`sourdaw_onboarding_completed`) to avoid re-triggering on subsequent visits unless explicitly restarted.
- **Non-Blocking Interaction**: Tour dismissal and navigation must never interrupt audio playback, track editing, or project loading.
- **Target Selector Stability**: Spotlight targets rely on DOM data-attributes or element selectors; verify selectors remain synchronized with UI component updates.

## Verification

```bash
pnpm vitest run src/modules/Onboarding
```
