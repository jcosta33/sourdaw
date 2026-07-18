/**
 * useWorkspaceState — TimelineEditor-local read of Workspace's public workspace
 * store (a cross-module read contract). Returning the full state keeps the hook
 * shape identical to Workspace's own and avoids per-field plumbing.
 */
import { useStore } from '#/infra/store/useStore';
import { workspaceStore, defaultWorkspaceState, type WorkspaceState } from '#/modules/WorkspaceShell/stores';

export const useWorkspaceState = (): WorkspaceState => {
    return useStore(workspaceStore, defaultWorkspaceState);
};
