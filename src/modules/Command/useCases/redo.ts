import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { type UndoEntry } from '../models/UndoEntry';
import { isActionEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { executeAppActionBatch } from './executeAppActionBatch';
import { recordAction } from './macro/recording/recordAction';
import { normalizeSingletonUndoGroups } from './normalizeSingletonUndoGroups';
import { REDO_NOT_APPLIED } from './redoResult';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

function commitRedoTransition(
    initialFuture: readonly UndoEntry[],
    retainedFuture: readonly UndoEntry[],
    pastEntries: readonly UndoEntry[]
): void {
    const live = undoStore.value;
    if (!live) {
        return;
    }
    const retainedIds = new Set(retainedFuture.map((entry) => entry.id));
    const removedIds = new Set(initialFuture.filter((entry) => !retainedIds.has(entry.id)).map((entry) => entry.id));
    const past = [...live.past, ...pastEntries];
    const future = live.future.filter((entry) => !removedIds.has(entry.id));
    undoStore.set({ past, future });
    undoTreeMoveTo(currentEntryId(past));
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

function recordRedoAction(entry: Extract<UndoEntry, { kind: 'action' }>): void {
    if (entry.source !== 'ai') {
        recordAction(entry.action);
    }
}

async function executeActionGroupRedo(entries: readonly UndoEntry[]): Promise<RedoOutcome> {
    if (!entries.every(isActionEntry)) {
        return { status: 'not-applied' };
    }

    const actions = entries.map((entry) => entry.redoAction ?? entry.action);
    const result = await executeAppActionBatch(actions, {
        skipUndo: true,
        skipMacroRecording: true,
        source: entries[0]?.source,
    });
    if (result.status === 'conflicted' || result.status === 'cancelled') {
        return { status: 'conflict' };
    }
    if (result.status === 'rejected' || result.status === 'failed') {
        throw new Error(`Grouped redo failed: ${result.reason}`);
    }

    for (const entry of entries) {
        recordRedoAction(entry);
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
    return { status: 'applied' };
}

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
            recordRedoAction(entry);
        } else if (entry.source === 'ai') {
            await executeAppAction(entry.action, {
                skipMacroRecording: true,
                source: 'ai',
            });
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
    const stored = undoStore.value;
    if (!stored || stored.future.length === 0) {
        return;
    }
    const state = normalizeSingletonUndoGroups(stored);
    if (state !== stored) {
        undoStore.set(state);
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

        if (entry.groupId) {
            const groupEntries: UndoEntry[] = [];
            for (const candidate of future) {
                if (candidate.groupId !== entry.groupId) {
                    break;
                }
                groupEntries.push(candidate);
            }
            if (groupEntries.every(isActionEntry)) {
                const outcome = await executeActionGroupRedo(groupEntries);
                if (outcome.status === 'conflict') {
                    if (future.length !== state.future.length) {
                        commitRedoTransition(state.future, future, []);
                    }
                    return;
                }

                future = future.slice(groupEntries.length);
                commitRedoTransition(state.future, future, groupEntries);
                if (outcome.status === 'committed') {
                    throw outcome.error;
                }
                return;
            }
        }

        const outcome = await executeRedo(entry);

        if (outcome.status === 'conflict') {
            // Nothing was written, so the entry stays at the head of `future`
            // and remains redoable. Only a purge of not-applied entries made
            // earlier in this scan needs persisting.
            if (future.length !== state.future.length) {
                commitRedoTransition(state.future, future, []);
            }
            return;
        }

        future = remainingFuture;
        if (outcome.status === 'applied' || outcome.status === 'committed') {
            commitRedoTransition(state.future, future, [entry]);
            if (outcome.status === 'committed') {
                throw outcome.error;
            }
            return;
        }
        // Not-applied entry: dropped; keep scanning.
    }

    // The whole future stack was not-applied: persist the purge so the wedge is gone.
    if (future.length !== state.future.length) {
        commitRedoTransition(state.future, future, []);
    }
}

export function redo(): Promise<void> {
    return runUndoRedoExclusive(redoImpl);
}
