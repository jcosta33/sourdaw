import { type EditingTool } from '#/modules/WorkspaceShell/stores';
import { setEditingTool as setEditingToolImpl } from '#/modules/WorkspaceShell/useCases';

export function setEditingTool(tool: EditingTool) {
    return setEditingToolImpl(tool);
}
