import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { isActionEntry, type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { executeAppActionBatch } from './executeAppActionBatch';
import { normalizeSingletonUndoGroups } from './normalizeSingletonUndoGroups';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

function undoEntryLabel(entry: UndoEntry): string {
    return entry.groupLabel || entry.label || (isActionEntry(entry) ? entry.action.type : 'action');
}

function commitUndoTransition(
    initialPast: readonly UndoEntry[],
    retainedPast: readonly UndoEntry[],
    futureEntries: readonly UndoEntry[]
): void {
    const live = undoStore.value;
    if (!live) {
        return;
    }
    const retainedIds = new Set(retainedPast.map((entry) => entry.id));
    const removedIds = new Set(initialPast.filter((entry) => !retainedIds.has(entry.id)).map((entry) => entry.id));
    const past = live.past.filter((entry) => !removedIds.has(entry.id));
    undoStore.set({ past, future: [...futureEntries, ...live.future] });
    undoTreeMoveTo(currentEntryId(past));
}

type ExecuteUndoInput = {
    entry: UndoEntry;
    runExecuteAppAction: typeof executeAppAction;
};

/**
 * What happened when one entry's undo side-effect ran.
 *
 * Audit CC-6 — the replay path used to report a bare boolean and let every
 * rejection escape, which conflated the two `executeAppAction` failures. They
 * demand opposite stack handling: a conflict wrote nothing (retry later), a
 * committed error already wrote (never replay it again).
 */
type UndoOutcome =
    /** The inverse was applied. */
    | { readonly status: 'undone' }
    /** No `inverseAction`: undoing is a no-op, so the entry is dropped. */
    | { readonly status: 'inert' }
    /** The transaction aborted; nothing was written and the entry stands. */
    | { readonly status: 'conflict' }
    /** The write landed but its bookkeeping failed; the stack must advance. */
    | { readonly status: 'committed'; readonly error: AppActionCommittedError };

async function executeActionGroupUndo(entries: readonly UndoEntry[]): Promise<UndoOutcome> {
    if (!entries.every(isActionEntry) || entries.some((entry) => entry.inverseAction === null)) {
        return { status: 'inert' };
    }

    const actions = [...entries].reverse().map((entry) => entry.inverseAction!);
    const result = await executeAppActionBatch(actions, {
        skipUndo: true,
        skipMacroRecording: true,
        source: entries[0]?.source,
    });
    if (result.status === 'conflicted' || result.status === 'cancelled') {
        return { status: 'conflict' };
    }
    if (result.status === 'rejected' || result.status === 'failed') {
        throw new Error(`Grouped undo failed: ${result.reason}`);
    }
    if (result.status === 'ambiguous') {
        return {
            status: 'committed',
            error: new AppActionCommittedError('appActionBatch', new Error(result.reason)),
        };
    }
    if (result.status === 'committed-with-warning') {
        return {
            status: 'committed',
            error: new AppActionCommittedError('appActionBatch', new Error(result.warning)),
        };
    }
    return { status: 'undone' };
}

/**
 * Performs the undo side-effect for one entry and reports what happened.
 * Action entries without an `inverseAction` are inert: undoing them is a no-op,
 * so the caller drops them instead of leaving them to wedge the stack above
 * older undoable entries. Dropped inert entries never reach `future` — nothing
 * was undone, so redo must not re-apply their action.
 */
async function executeUndo({ entry, runExecuteAppAction }: ExecuteUndoInput): Promise<UndoOutcome> {
    if (entry.kind === 'callback') {
        entry.undo();
        return { status: 'undone' };
    }
    if (!entry.inverseAction) {
        return { status: 'inert' };
    }

    try {
        await runExecuteAppAction(entry.inverseAction, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        return { status: 'undone' };
    } catch (error) {
        if (error instanceof AppActionConflictError) {
            return { status: 'conflict' };
        }
        if (error instanceof AppActionCommittedError) {
            return { status: 'committed', error };
        }
        throw error;
    }
}

async function undoImpl(): Promise<void> {
    const stored = undoStore.value;
    if (!stored || stored.past.length === 0) {
        return;
    }
    const initial = normalizeSingletonUndoGroups(stored);
    if (initial !== stored) {
        undoStore.set(initial);
    }

    let past = initial.past;
    // Scan downwards until something is actually undone. Inert entries (action
    // entries without an inverseAction) are dropped along the way so they can
    // never wedge the undoable entries beneath them.
    while (past.length > 0) {
        const lastEntry = past[past.length - 1]!;

        if (lastEntry.groupId) {
            const groupEntries: UndoEntry[] = [];
            let index = past.length - 1;
            while (index >= 0 && past[index]!.groupId === lastEntry.groupId) {
                groupEntries.unshift(past[index]!);
                index--;
            }
            past = past.slice(0, index + 1);

            const isAtomicActionGroup =
                groupEntries.every(isActionEntry) && groupEntries.every((entry) => entry.inverseAction !== null);
            if (isAtomicActionGroup) {
                const outcome = await executeActionGroupUndo(groupEntries);
                if (outcome.status === 'conflict') {
                    const label = undoEntryLabel(lastEntry);
                    notifyUser(`Cannot undo "${label}": project state has changed`, 'warning');
                    return;
                }

                commitUndoTransition(initial.past, past, groupEntries);
                if (outcome.status === 'committed') {
                    throw outcome.error;
                }
                return;
            }

            const undoneEntries: UndoEntry[] = [];
            let retainedEntries: UndoEntry[] = [];
            let committedError: AppActionCommittedError | undefined;

            for (let groupIndex = groupEntries.length - 1; groupIndex >= 0; groupIndex--) {
                const entry = groupEntries[groupIndex]!;
                const outcome = await executeUndo({
                    entry,
                    runExecuteAppAction: executeAppAction,
                });

                if (outcome.status === 'conflict') {
                    const label = undoEntryLabel(entry);
                    notifyUser(`Cannot undo "${label}": project state has changed`, 'warning');
                    // Conflicting entry cannot be undone; drop it and remaining un-undone
                    // group entries from past so the stack does not wedge.
                    commitUndoTransition(initial.past, past, undoneEntries);
                    return;
                }
                if (outcome.status === 'inert') {
                    continue;
                }

                undoneEntries.unshift(entry);
                if (outcome.status === 'committed') {
                    retainedEntries = groupEntries.slice(0, groupIndex);
                    committedError = outcome.error;
                    break;
                }
            }

            if (undoneEntries.length === 0 && retainedEntries.length === 0) {
                // The whole group was inert: it is dropped; keep scanning.
                continue;
            }

            const nextPast = [...past, ...retainedEntries];
            if (undoneEntries.length > 0 || nextPast.length !== initial.past.length) {
                commitUndoTransition(initial.past, nextPast, undoneEntries);
            }
            if (committedError !== undefined) {
                throw committedError;
            }
            return;
        }

        const outcome = await executeUndo({
            entry: lastEntry,
            runExecuteAppAction: executeAppAction,
        });

        if (outcome.status === 'conflict') {
            const label = undoEntryLabel(lastEntry);
            notifyUser(`Cannot undo "${label}": project state has changed`, 'warning');
            return;
        }

        past = past.slice(0, -1);
        if (outcome.status === 'undone' || outcome.status === 'committed') {
            commitUndoTransition(initial.past, past, [lastEntry]);
            if (outcome.status === 'committed') {
                throw outcome.error;
            }
            return;
        }
        // Inert entry: dropped without reaching future; keep scanning.
    }

    // The stack held only inert entries: persist the purge so the wedge is gone.
    if (past.length !== initial.past.length) {
        commitUndoTransition(initial.past, past, []);
    }
}

export function undo(): Promise<void> {
    return runUndoRedoExclusive(undoImpl);
}
