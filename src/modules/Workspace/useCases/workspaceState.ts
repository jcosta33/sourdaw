import { updateWorkspaceState as updateWorkspaceStateRepo } from '../repositories/workspace';
import { type WorkspaceState } from '../models/WorkspaceState';

export function updateWorkspaceState(partial: Partial<WorkspaceState>): void {
    updateWorkspaceStateRepo(partial);
}
