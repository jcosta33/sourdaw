/**
 * Workspace keyboard shortcut delegates.
 */
import {
    setEditingTool as _setEditingTool,
    zoomToFit as _zoomToFit,
    zoomToSelection as _zoomToSelection,
    type EditingTool,
} from '#/modules/Workspace';

export const setEditingTool = (tool: EditingTool): void => _setEditingTool(tool);
export const zoomToFit = (): void => _zoomToFit();
export const zoomToSelection = (): void => _zoomToSelection();
