/**
 * Workspace keyboard shortcut delegates.
 */
import { inject } from '#/infra/di/inject';
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

export const setEditingTool = inject(workspaceShortcutsDependencies)((d) => (tool: EditingTool) =>
    d.setEditingTool(tool)
);
export const zoomToFit = inject(workspaceShortcutsDependencies)((d) => () => d.zoomToFit());
export const zoomToSelection = inject(workspaceShortcutsDependencies)((d) => () => d.zoomToSelection());
