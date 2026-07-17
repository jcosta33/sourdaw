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
};

export type CallbackUndoEntry = UndoEntryBase & {
    kind: 'callback';
    undo: () => void;
    redo: () => unknown;
};

export type UndoEntry = ActionUndoEntry | CallbackUndoEntry;
