import { pushActionHistoryEntry, type ActionHistoryEntry } from '../stores/actionHistoryStore';

type RecordActionHistoryEntryInput = ActionHistoryEntry;

type RecordActionHistoryEntryOutput = string[];

export function recordActionHistoryEntry(entry: RecordActionHistoryEntryInput): RecordActionHistoryEntryOutput {
    return pushActionHistoryEntry(entry);
}
