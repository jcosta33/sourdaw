import { type ActionUndoEntry, type UndoEntry } from '../models/UndoEntry';

export function isActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    return entry.kind === 'action';
}
