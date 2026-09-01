export type CanvasEditorCommand = Extract<SourdawNativeMenuAction, `edit:${string}`>;

export type CanvasEditorCommandRequest = {
    readonly action: CanvasEditorCommand;
    handled: boolean;
};

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
    const request: CanvasEditorCommandRequest = { action, handled: false };
    editor.dispatchEvent(new CustomEvent<CanvasEditorCommandRequest>(CANVAS_EDITOR_COMMAND_EVENT, { detail: request }));
    return request.handled;
};
