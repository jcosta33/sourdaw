// CommandInterface/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { setShortcutMapping } from './setShortcutMapping';
export { resetShortcutMappings } from './resetShortcutMappings';
export { isKeyboardEditableTarget } from './isKeyboardEditableTarget';
export { isNativeTextEditableTarget } from './isNativeTextEditableTarget';
export { CANVAS_EDITOR_COMMAND_EVENT, dispatchCanvasEditorCommand } from './dispatchCanvasEditorCommand';
export { isCanvasEditorCommandRequest } from './isCanvasEditorCommandRequest';
