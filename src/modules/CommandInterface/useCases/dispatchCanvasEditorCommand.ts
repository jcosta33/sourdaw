export type CanvasEditorCommand = Extract<SourdawNativeMenuAction, `edit:${string}`>;

export const CANVAS_EDITOR_COMMAND_EVENT = 'sourdaw:canvas-editor-command';

/**
 * Delivers a native Edit menu command to the focused canvas editor that owns
 * its shortcut semantics. This is deliberately not a synthesized keyboard
 * event: the editor receives an explicit command at its own boundary.
 */
export const dispatchCanvasEditorCommand = (target: Element | null, action: CanvasEditorCommand): boolean => {
    const editor = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-canvas-editor]') : null;
    if (editor === null) {
        return false;
    }
    editor.dispatchEvent(new CustomEvent<CanvasEditorCommand>(CANVAS_EDITOR_COMMAND_EVENT, { detail: action }));
    return true;
};
