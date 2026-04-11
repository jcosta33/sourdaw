import {
    type EditingTool,
    setEditingTool as setEditingToolImpl,
    zoomToFit as zoomToFitImpl,
    zoomToSelection as zoomToSelectionImpl,
} from '#/modules/Workspace/useCases';

export const workspaceShortcutsDependencies = {
    setEditingTool: setEditingToolImpl,
    zoomToFit: zoomToFitImpl,
    zoomToSelection: zoomToSelectionImpl,
} as const;

export function setEditingTool(tool: EditingTool) {
    return setEditingToolImpl(tool);
}

export function zoomToFit() {
    return zoomToFitImpl();
}

export function zoomToSelection() {
    return zoomToSelectionImpl();
}
