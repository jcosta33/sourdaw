import { type WorkspaceState } from '../models/WorkspaceState';
import { workspaceStore } from '../stores/workspaceStore';

export function getWorkspaceState(): WorkspaceState | null {
    return workspaceStore.value;
}

export function updateWorkspaceState(patch: Partial<WorkspaceState>): void {
    const current = workspaceStore.value;
    if (!current) {
        return;
    }
    workspaceStore.set({ ...current, ...patch });
}
