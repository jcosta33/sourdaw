import { type CommandHistoryReplay } from '#/utils/handlerContract';

import { type CallbackUndoEntry, type UndoSource } from '../models/UndoEntry';

type CreateCallbackUndoEntryInput = {
    label: string;
    undo: CommandHistoryReplay;
    redo: CommandHistoryReplay;
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
