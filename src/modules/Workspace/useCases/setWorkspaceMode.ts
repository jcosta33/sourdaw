import { inject } from '#/infra/di/inject';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';
import { type WorkspaceMode } from './workspaceQueries';

export const setWorkspaceMode = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function setWorkspaceMode(mode: WorkspaceMode): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ mode });
        }
);
