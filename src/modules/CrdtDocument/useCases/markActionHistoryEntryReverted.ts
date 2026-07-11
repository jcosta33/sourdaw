import { markEntryReverted } from '../stores/actionHistoryStore';

type MarkActionHistoryEntryRevertedInput = string;

export function markActionHistoryEntryReverted(entryId: MarkActionHistoryEntryRevertedInput): void {
    markEntryReverted(entryId);
}
