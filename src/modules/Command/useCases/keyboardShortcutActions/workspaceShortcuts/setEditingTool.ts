import { type EditingTool, setEditingTool as setEditingToolImpl } from '#/modules/Workspace/useCases';

export function setEditingTool(tool: EditingTool) {
    return setEditingToolImpl(tool);
}
