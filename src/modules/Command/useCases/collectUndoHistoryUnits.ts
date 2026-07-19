import { type UndoEntry } from '../models/UndoEntry';

export type UndoHistoryUnit = {
    id: string;
    entry: UndoEntry;
};

export function collectUndoHistoryUnits(entries: readonly UndoEntry[]): UndoHistoryUnit[] {
    const units: UndoHistoryUnit[] = [];
    for (let start = 0; start < entries.length; ) {
        const first = entries[start]!;
        const transactionGroupId = first.transactionGroupId;
        let end = start + 1;
        if (transactionGroupId) {
            while (entries[end]?.transactionGroupId === transactionGroupId) {
                end += 1;
            }
        }
        units.push({
            id: transactionGroupId ? `transaction:${transactionGroupId}` : `entry:${first.id}`,
            entry: entries[end - 1]!,
        });
        start = end;
    }
    return units;
}
