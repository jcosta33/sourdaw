import { pushActionHistoryEntry, type ActionHistoryEntry } from '../stores/actionHistoryStore';

type RecordActionHistoryEntryInput = ActionHistoryEntry;

export function recordActionHistoryEntry(entry: RecordActionHistoryEntryInput): void {
    pushActionHistoryEntry(entry);
}
