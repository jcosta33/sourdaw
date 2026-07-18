// Workspace/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { workspaceStore, defaultWorkspaceState } from './workspaceStore';
export type { WorkspaceState, EditingTool } from './workspaceStore';
export { toolSwapStore } from './toolSwapStore';

export { alphaNoticeStore } from './alphaNoticeStore';
