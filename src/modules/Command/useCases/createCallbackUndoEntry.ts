import { type CallbackUndoEntry, type UndoSource } from './commandQueries';

export function createCallbackUndoEntry(
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    source: UndoSource = 'manual'
): CallbackUndoEntry {
    return {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'callback',
        label,
        undo: undoFn,
        redo: redoFn,
        timestamp: Date.now(),
        source,
    };
}
