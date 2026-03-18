import { type WorkspaceMode } from '../models/WorkspaceState';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspaceRepository';

export function setWorkspaceMode(mode: WorkspaceMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode });
}
