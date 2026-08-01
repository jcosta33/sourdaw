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
};

export type UndoEntry = ActionUndoEntry | CallbackUndoEntry;

export function isActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    return entry.kind === 'action';
}
