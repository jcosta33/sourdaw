import { pushActionHistoryEntries, type ActionHistoryEntry } from '../stores/actionHistoryStore';

type RecordActionHistoryEntriesInput = readonly ActionHistoryEntry[];

type RecordActionHistoryEntriesOutput = string[];

export function recordActionHistoryEntries(entries: RecordActionHistoryEntriesInput): RecordActionHistoryEntriesOutput {
    return pushActionHistoryEntries(entries);
}
