import { markEntryReverted } from '../stores/actionHistoryStore';

type MarkActionHistoryEntryRevertedInput = {
    entryId: string;
    expectedFingerprint: string;
};

export function markActionHistoryEntryReverted(input: MarkActionHistoryEntryRevertedInput): ReturnType<typeof markEntryReverted> {
    return markEntryReverted(input);
}
