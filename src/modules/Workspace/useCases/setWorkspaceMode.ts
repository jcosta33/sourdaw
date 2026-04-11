import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';
import { type WorkspaceMode } from './workspaceQueries';

export function setWorkspaceMode(mode: WorkspaceMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode });
}
