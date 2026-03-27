/**
 * Workspace keyboard shortcut delegates.
 */
import { setEditingTool as _setEditingTool } from '#/modules/Workspace/useCases/setEditingTool';
import { zoomToFit as _zoomToFit, zoomToSelection as _zoomToSelection } from '#/modules/Workspace/useCases/togglePanel/zoomOperations';
import { type EditingTool } from '#/modules/Workspace/useCases/setEditingTool';

export const setEditingTool = (tool: EditingTool): void => _setEditingTool(tool);
export const zoomToFit = (): void => _zoomToFit();
export const zoomToSelection = (): void => _zoomToSelection();
