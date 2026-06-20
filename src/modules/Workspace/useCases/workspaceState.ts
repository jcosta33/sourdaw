import { updateWorkspaceState as updateWorkspaceStateRepo } from '../repositories/updateWorkspaceState';

import { type WorkspaceState } from './workspaceQueries/helpers';

export function updateWorkspaceState(partial: Partial<WorkspaceState>): void {
    updateWorkspaceStateRepo(partial);
}
