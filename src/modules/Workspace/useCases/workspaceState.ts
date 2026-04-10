import { inject } from '#/infra/di/inject';
import { updateWorkspaceState as updateWorkspaceStateRepo } from '../repositories/workspace';
import { type WorkspaceState } from './workspaceQueries';

export const updateWorkspaceState = inject({ updateWorkspaceStateRepo })(
    ({ updateWorkspaceStateRepo }) =>
        function updateWorkspaceState(partial: Partial<WorkspaceState>): void {
            updateWorkspaceStateRepo(partial);
        }
);
