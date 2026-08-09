import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { normalizeSingletonUndoGroups } from './normalizeSingletonUndoGroups';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
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
    const future = initial.future;

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
                    // This entry was not undone, so it and every older entry
                    // in the group stay on the stack. The newer entries that
                    // were already undone must still leave `past`, or a
                    // retry would apply their inverses a second time.
                    retainedEntries = groupEntries.slice(0, groupIndex + 1);
                    break;
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
                undoStore.set({
                    past: nextPast,
                    future: [...undoneEntries, ...future],
                });
                undoTreeMoveTo(currentEntryId(nextPast));
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
            // Nothing was written, so the entry stays undoable. Only a purge
            // of inert entries made earlier in this scan needs persisting.
            if (past.length !== initial.past.length) {
                undoStore.set({ past, future });
                undoTreeMoveTo(currentEntryId(past));
            }
            return;
        }

        past = past.slice(0, -1);
        if (outcome.status === 'undone' || outcome.status === 'committed') {
            undoStore.set({
                past,
                future: [lastEntry, ...future],
            });
            undoTreeMoveTo(currentEntryId(past));
            if (outcome.status === 'committed') {
                throw outcome.error;
            }
            return;
        }
        // Inert entry: dropped without reaching future; keep scanning.
    }

    // The stack held only inert entries: persist the purge so the wedge is gone.
    if (past.length !== initial.past.length) {
        undoStore.set({ past, future });
        undoTreeMoveTo(currentEntryId(past));
    }
}

export function undo(): Promise<void> {
    return runUndoRedoExclusive(undoImpl);
}
