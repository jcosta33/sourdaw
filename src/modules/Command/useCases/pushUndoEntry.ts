import { createCallbackUndoEntry, type UndoSource } from "../models/UndoEntry";
import { pushUndo } from "../stores/undoStore";

/**
 * Lightweight undo entry for direct UI interactions that bypass executeAppAction.
 * Stores undo/redo as closures — suitable for MIDI edits, clip drags, automation
 * drawing, and other real-time gestures where routing through the command system
 * would be too slow.
 */
export const pushUndoEntry = (
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    options?: { groupId?: string; groupLabel?: string; source?: UndoSource },
): void => {
    const entry = createCallbackUndoEntry(label, undoFn, redoFn, options?.source ?? "manual");
    if (options?.groupId) {
        entry.groupId = options.groupId;
        entry.groupLabel = options.groupLabel;
    }
    pushUndo(entry);
};
