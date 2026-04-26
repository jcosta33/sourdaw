import { type AppAction } from './AppAction';

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
};

export type CallbackUndoEntry = UndoEntryBase & {
    kind: 'callback';
    undo: () => void;
    redo: () => void;
};

export type UndoEntry = ActionUndoEntry | CallbackUndoEntry;

export function createUndoEntry(
    label: string,
    action: AppAction,
    inverseAction: AppAction | null,
    source: UndoSource = 'manual'
): ActionUndoEntry {
    return {
        id: `undo-${crypto.randomUUID()}`,
        kind: 'action',
        label,
        action,
        inverseAction,
        timestamp: Date.now(),
        source,
    };
}

export function createCallbackUndoEntry(
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    source: UndoSource = 'manual'
): CallbackUndoEntry {
    return {
        id: `undo-${crypto.randomUUID()}`,
        kind: 'callback',
        label,
        undo: undoFn,
        redo: redoFn,
        timestamp: Date.now(),
        source,
    };
}

export function generateGroupId(label: string): { groupId: string; groupLabel: string } {
    return {
        groupId: `group-${crypto.randomUUID()}`,
        groupLabel: label,
    };
}

export function isActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    return entry.kind === 'action';
}
