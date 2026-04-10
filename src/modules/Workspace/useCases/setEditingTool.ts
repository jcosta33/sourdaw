import { inject } from '#/infra/di/inject';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';
import { type EditingTool } from './workspaceQueries';

export const setEditingTool = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function setEditingTool(tool: EditingTool): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ activeTool: tool });
        }
);
