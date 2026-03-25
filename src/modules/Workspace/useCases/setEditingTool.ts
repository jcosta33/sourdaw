import { type EditingTool } from '../models/EditingTool';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';

export type { EditingTool };

export function setEditingTool(tool: EditingTool): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ activeTool: tool });
}
