import { type CallbackUndoEntry, type UndoSource } from './commandQueries';

type CreateCallbackUndoEntryInput = {
    label: string;
    undo: () => void;
    redo: () => void;
    source?: UndoSource;
};

export function createCallbackUndoEntry({
    label,
    undo,
    redo,
    source = 'manual',
}: CreateCallbackUndoEntryInput): CallbackUndoEntry {
    return {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'callback',
        label,
        undo,
        redo,
        timestamp: Date.now(),
        source,
    };
}
