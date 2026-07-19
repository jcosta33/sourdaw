import { type AppAction } from '#/utils/handlerContract';

export type UndoSource = 'manual' | 'prompt' | 'voice' | 'ai';

type UndoEntryBase = {
    id: string;
    label: string;
    timestamp: number;
    source: UndoSource;
    /** Correlation identity for display/history, independent of transactional undo. */
    groupId?: string;
    groupLabel?: string;
    /** Membership in an undo/redo group with one owning aggregate implementation. */
    transactionGroupId?: string;
};

export type ActionUndoEntry = UndoEntryBase & {
    kind: 'action';
    action: AppAction;
    inverseAction: AppAction | null;
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
