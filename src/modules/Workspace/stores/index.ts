// Workspace/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { preferencesStore } from './preferencesStore';

export { workspaceStore, defaultWorkspaceState } from './workspaceStore';
export { toolSwapStore } from './toolSwapStore';

export { onboardingStore, defaultOnboardingState } from './onboardingStore';
export type { OnboardingState } from './onboardingStore';

export { alphaNoticeStore } from './alphaNoticeStore';
