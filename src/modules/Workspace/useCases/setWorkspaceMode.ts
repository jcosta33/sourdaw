import { inject } from '#/infra/di/inject';
import { type WorkspaceMode } from '../models/WorkspaceState';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';

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
