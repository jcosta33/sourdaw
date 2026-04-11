import {
    setEditingTool as setEditingToolImpl,
    zoomToFit as zoomToFitImpl,
    zoomToSelection as zoomToSelectionImpl,
} from '#/modules/Workspace/useCases';

export const workspaceShortcutsDependencies = {
    setEditingTool: setEditingToolImpl,
    zoomToFit: zoomToFitImpl,
    zoomToSelection: zoomToSelectionImpl,
} as const;