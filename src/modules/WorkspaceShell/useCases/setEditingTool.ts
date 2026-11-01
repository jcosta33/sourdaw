import { type EditingTool } from '../models/EditingTool';
import { getWorkspaceState } from '../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../repositories/updateWorkspaceState';

export function setEditingTool(tool: EditingTool): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ activeTool: tool });
}
