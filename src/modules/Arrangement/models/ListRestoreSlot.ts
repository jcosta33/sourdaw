// Where a removed list item goes back. List order is project truth, and a
// collaborator can remove or reorder siblings between a removal and its undo,
// so the slot names the item's neighbours by id; ids survive those edits where
// a bare index does not.
export type ListRestoreSlot = {
    /** Position the item held when removed; the last resort. */
    index?: number;
    /** Id of the item that followed it. */
    beforeId?: string;
    /** Id of the item that preceded it. */
    afterId?: string;
};

export function readListRestoreSlot(items: readonly { id: string }[], index: number): ListRestoreSlot {
    const slot: ListRestoreSlot = { index };
    const next = items[index + 1];
    const previous = items[index - 1];
    if (next) {
        slot.beforeId = next.id;
    }
    if (previous) {
        slot.afterId = previous.id;
    }
    return slot;
}

// An anchor naming no current item is the concurrent case, not a malformed one.
export function isValidListRestoreSlot(slot: { index?: unknown; beforeId?: unknown; afterId?: unknown }): boolean {
    const { index, beforeId, afterId } = slot;
    const indexValid = index === undefined || (typeof index === 'number' && Number.isInteger(index) && index >= 0);
    return (
        indexValid &&
        (beforeId === undefined || typeof beforeId === 'string') &&
        (afterId === undefined || typeof afterId === 'string')
    );
}

// Before the old successor, else after the old predecessor, else the recorded
// index clamped to the list, else the end (no slot: a fresh add).
export function insertAtListRestoreSlot<TItem extends { id: string }>(
    items: readonly TItem[],
    item: TItem,
    slot: ListRestoreSlot
): TItem[] {
    const slotIndex = resolveListRestoreIndex(items, slot);
    return [...items.slice(0, slotIndex), item, ...items.slice(slotIndex)];
}

function resolveListRestoreIndex(items: readonly { id: string }[], slot: ListRestoreSlot): number {
    const beforeIndex = slot.beforeId === undefined ? -1 : items.findIndex((item) => item.id === slot.beforeId);
    if (beforeIndex >= 0) {
        return beforeIndex;
    }
    const afterIndex = slot.afterId === undefined ? -1 : items.findIndex((item) => item.id === slot.afterId);
    if (afterIndex >= 0) {
        return afterIndex + 1;
    }
    return Math.min(slot.index ?? items.length, items.length);
}
