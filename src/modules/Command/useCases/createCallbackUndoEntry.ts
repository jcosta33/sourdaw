import { type CallbackUndoEntry, type UndoSource } from '../models/UndoEntry';

type CreateCallbackUndoEntryInput = {
    label: string;
    undo: () => void;
    redo: () => unknown;
    source?: UndoSource;
    /** Audio buffer ids the closures can restore. See `CallbackUndoEntry`. */
    restoresBufferIds?: readonly string[];
};

export function createCallbackUndoEntry({
    label,
    undo,
    redo,
    source = 'manual',
    restoresBufferIds,
}: CreateCallbackUndoEntryInput): CallbackUndoEntry {
    return {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'callback',
        label,
        undo,
        redo,
        timestamp: Date.now(),
        source,
        ...(restoresBufferIds ? { restoresBufferIds } : {}),
    };
}
