import { isActionEntry, type UndoEntry } from './UndoEntry';

/**
 * One undo unit: what a single undo or redo consumes. An entry without a
 * `groupId` is a unit on its own; a contiguous run of entries sharing one
 * `groupId` is a single unit. Indices are inclusive positions in the stack the
 * unit was read from.
 */
export type UndoUnitSpan = {
    readonly first: number;
    readonly last: number;
};

type Groupable = Pick<UndoEntry, 'groupId'>;

/** Whether two adjacent entries belong to the same undo unit. */
function sharesUndoUnit(earlier: Groupable, later: Groupable): boolean {
    return Boolean(earlier.groupId) && earlier.groupId === later.groupId;
}

function unitStartingAt(entries: readonly Groupable[], first: number): UndoUnitSpan {
    let last = first;
    while (last + 1 < entries.length && sharesUndoUnit(entries[last]!, entries[last + 1]!)) {
        last++;
    }
    return { first, last };
}

function unitEndingAt(entries: readonly Groupable[], last: number): UndoUnitSpan {
    let first = last;
    while (first > 0 && sharesUndoUnit(entries[first - 1]!, entries[first]!)) {
        first--;
    }
    return { first, last };
}

/** The newest unit of an oldest-first stack (`past`): the unit undo consumes next. */
export function newestUndoUnit(entries: readonly Groupable[]): UndoUnitSpan | null {
    return entries.length === 0 ? null : unitEndingAt(entries, entries.length - 1);
}

/** The unit at the head of `future` (`future[0]` first): the unit redo consumes next. */
export function nextUndoUnit(entries: readonly Groupable[]): UndoUnitSpan | null {
    return entries.length === 0 ? null : unitStartingAt(entries, 0);
}

/** Every unit of a stack, in stack order. */
export function partitionUndoUnits(entries: readonly Groupable[]): UndoUnitSpan[] {
    const units: UndoUnitSpan[] = [];
    let first = 0;
    while (first < entries.length) {
        const unit = unitStartingAt(entries, first);
        units.push(unit);
        first = unit.last + 1;
    }
    return units;
}

/** An entry undo can never revert: an action entry without an `inverseAction`. */
export function isInertUndoEntry(entry: UndoEntry): boolean {
    return isActionEntry(entry) && entry.inverseAction === null;
}

/**
 * Whether undo drops this unit without running anything: every member is
 * inert. A mixed unit still has a member that writes (or a callback that runs),
 * so only a fully inert unit is purged, and it never costs the user an undo.
 */
export function isInertUndoUnit(entries: readonly UndoEntry[]): boolean {
    return entries.every(isInertUndoEntry);
}

/** The name undo and redo give an entry, and through its head entry, its unit. */
export function undoEntryLabel(entry: UndoEntry): string {
    return entry.groupLabel || entry.label || (isActionEntry(entry) ? entry.action.type : 'action');
}
