import { type AppAction } from '#/utils/handlerContract';

export type UndoSource = 'manual' | 'prompt' | 'voice' | 'ai';

type UndoEntryBase = {
    id: string;
    label: string;
    timestamp: number;
    source: UndoSource;
    groupId?: string;
    groupLabel?: string;
};

export type ActionUndoEntry = UndoEntryBase & {
    kind: 'action';
    action: AppAction;
    inverseAction: AppAction | null;
    /** Optional snapshot-exact replay used when recomputing `action` against later state is unsafe. */
    redoAction?: AppAction;
};

export type CallbackUndoEntry = UndoEntryBase & {
    kind: 'callback';
    undo: () => void;
    redo: () => unknown;
    /** Audio buffer ids the undo/redo closures can restore, declared by the
     * producing module at push time while its state is in hand. Buffer-ownership
     * queries read this declaration instead of interpreting the closures; an
     * entry without it is treated as restoring no audio. */
    restoresBufferIds?: readonly string[];
};

export type UndoEntry = ActionUndoEntry | CallbackUndoEntry;

export function isActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    return entry.kind === 'action';
}
