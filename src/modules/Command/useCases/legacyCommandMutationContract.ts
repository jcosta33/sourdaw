import { type UndoSource } from '../models/UndoEntry';

type LegacyUndoOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: UndoSource;
};

export type CommitLegacyUndo = (
    label: string,
    undo: () => void,
    redo: () => unknown,
    options?: LegacyUndoOptions
) => void;

export type LegacyCommandMutation<Output> = (commitUndo: CommitLegacyUndo) => Promise<Output> | Output;
