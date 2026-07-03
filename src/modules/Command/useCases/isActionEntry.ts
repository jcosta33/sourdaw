import { type ActionUndoEntry, type UndoEntry } from './commandQueries';

export function isActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    return entry.kind === 'action';
}
