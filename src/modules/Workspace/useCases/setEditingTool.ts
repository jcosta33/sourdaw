import { inject } from '#/infra/di/inject';
import { type EditingTool } from '../models/EditingTool';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';

export type { EditingTool };

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
