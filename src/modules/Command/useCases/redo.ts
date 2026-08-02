import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { recordAction } from './macro/recording/recordAction';
import { REDO_NOT_APPLIED } from './redoResult';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

/**
 * What happened when one entry's redo side-effect ran. Audit CC-6 — mirrors
 * `UndoOutcome`: a conflict wrote nothing and the entry stays redoable, while
 * a committed error already wrote and must never be re-applied.
 */
type RedoOutcome =
    | { readonly status: 'applied' }
    | { readonly status: 'not-applied' }
    | { readonly status: 'conflict' }
    | { readonly status: 'committed'; readonly error: AppActionCommittedError };

async function executeRedo(entry: UndoEntry): Promise<RedoOutcome> {
    if (entry.kind === 'callback') {
        if (entry.redo() === REDO_NOT_APPLIED) {
            return { status: 'not-applied' };
        }
        return { status: 'applied' };
    }

    try {
        if (entry.redoAction) {
            await executeAppAction(entry.redoAction, {
                skipUndo: true,
                skipMacroRecording: true,
                source: entry.source,
            });
            recordAction(entry.action);
        } else {
            await executeAppAction(entry.action);
        }
        return { status: 'applied' };
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

async function redoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    let future = state.future;

    // Scan forwards until something is actually re-applied. Callback entries that
    // report REDO_NOT_APPLIED can never re-apply (their forward path is gone), so
    // they are dropped without reaching past — mirroring undo()'s inert-drop.
    // Pinning such an entry at future[0] would deadlock every redoable entry
    // behind it.
    while (future.length > 0) {
        const entry = future[0]!;
        const remainingFuture = future.slice(1);

        const outcome = await executeRedo(entry);

        if (outcome.status === 'conflict') {
            // Nothing was written, so the entry stays at the head of `future`
            // and remains redoable. Only a purge of not-applied entries made
            // earlier in this scan needs persisting.
            if (future.length !== state.future.length) {
                undoStore.set({ past: state.past, future });
                undoTreeMoveTo(currentEntryId(state.past));
            }
            return;
        }

        future = remainingFuture;
        if (outcome.status === 'applied' || outcome.status === 'committed') {
            const newPast = [...state.past, entry];
            undoStore.set({
                past: newPast,
                future,
            });
            undoTreeMoveTo(currentEntryId(newPast));
            if (outcome.status === 'committed') {
                throw outcome.error;
            }
            return;
        }
        // Not-applied entry: dropped; keep scanning.
    }

    // The whole future stack was not-applied: persist the purge so the wedge is gone.
    if (future.length !== state.future.length) {
        undoStore.set({ past: state.past, future });
        undoTreeMoveTo(currentEntryId(state.past));
    }
}

export function redo(): Promise<void> {
    return runUndoRedoExclusive(redoImpl);
}
