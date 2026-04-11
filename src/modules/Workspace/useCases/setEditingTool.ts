import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';
import { type EditingTool } from './workspaceQueries/helpers';

export function setEditingTool(tool: EditingTool): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ activeTool: tool });
}
