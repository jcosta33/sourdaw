import { type WorkspaceState } from '../models/WorkspaceState';
import { workspaceStore } from '../stores/workspaceStore';

export function getWorkspaceState(): WorkspaceState | null {
    return workspaceStore.value;
}

export function updateWorkspaceState(patch: Partial<WorkspaceState>): void {
    const current = workspaceStore.value;
    if (current === null) {
        // The store is seeded synchronously with defaultWorkspaceState at module load,
        // so a null here is an invariant violation (e.g. someone cleared the store),
        // not a normal state to silently swallow.
        throw new Error('updateWorkspaceState: workspaceStore is not initialized');
    }
    workspaceStore.set({ ...current, ...patch });
}
