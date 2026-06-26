import { type EditingTool } from '#/modules/Workspace/stores';
import { setEditingTool as setEditingToolImpl } from '#/modules/Workspace/useCases';

export function setEditingTool(tool: EditingTool) {
    return setEditingToolImpl(tool);
}
