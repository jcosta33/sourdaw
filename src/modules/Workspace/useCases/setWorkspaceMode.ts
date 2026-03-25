import { type WorkspaceMode } from '../models/WorkspaceState';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';

export function setWorkspaceMode(mode: WorkspaceMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode });
}
