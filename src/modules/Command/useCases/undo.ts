import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { isActionEntry, type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { executeAppActionBatch } from './executeAppActionBatch';
import { normalizeSingletonUndoGroups } from './normalizeSingletonUndoGroups';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** What one `undo()` call did to the entry that headed `past` when it began. */
export type UndoResult = {
    /**
     * `false` when that entry is still on `past`, because its inverse conflicted
     * and wrote nothing. A caller sweeping the history must stop there rather
     * than count entries: one call also drops any inert entries it passes, so
     * `past` can shorten by more than the sweep asked for, and stack length says
     * nothing about whether the entry it stopped at is still applied.
     */
    readonly headConsumed: boolean;
};

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

function undoEntryLabel(entry: UndoEntry): string {
    return entry.groupLabel || entry.label || (isActionEntry(entry) ? entry.action.type : 'action');
}

function notifyUndoConflict(label: string): void {
    notifyUser(`Cannot undo "${label}": project state has changed`, 'warning');
}

function notifyPartialGroupUndo(label: string): void {
    notifyUser(`Only part of "${label}" could be undone: project state has changed`, 'warning');
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

/**
 * The newest undoable unit on `past`: one entry, or the whole contiguous run of
 * entries sharing its `groupId`.
 */
type UndoCandidate = {
    /** The newest entry of the unit; its label names the unit to the user. */
    readonly head: UndoEntry;
    /** The unit's entries, oldest first. */
    readonly entries: readonly UndoEntry[];
    /** What remains of `past` beneath the unit. */
    readonly below: readonly UndoEntry[];
};

function takeCandidate(past: readonly UndoEntry[]): UndoCandidate | null {
    if (past.length === 0) {
        return null;
    }
    const head = past[past.length - 1]!;
    if (!head.groupId) {
        return { head, entries: [head], below: past.slice(0, -1) };
    }

    let index = past.length - 1;
    while (index >= 0 && past[index]!.groupId === head.groupId) {
        index--;
    }
    return { head, entries: past.slice(index + 1), below: past.slice(0, index + 1) };
}

/**
 * Whether the whole unit can be replayed as one inverse batch. That needs every
 * member to be an action entry carrying an `inverseAction`; a callback member has
 * no action to batch, and a member without an inverse has nothing to contribute.
 * Anything else is replayed member by member instead.
 */
function isAtomicActionGroup(entries: readonly UndoEntry[]): boolean {
    return entries.every((entry) => isActionEntry(entry) && entry.inverseAction !== null);
}

type CandidateOutcome =
    /** At least one entry was undone. `retained` keeps its place on `past`. */
    | {
          readonly status: 'undone';
          readonly undone: readonly UndoEntry[];
          readonly retained: readonly UndoEntry[];
          /** An older member of the same unit conflicted after the undone ones ran. */
          readonly partialConflict: boolean;
          readonly committedError?: AppActionCommittedError | undefined;
      }
    /** Nothing to undo and nothing written: the unit is dropped. */
    | { readonly status: 'inert' }
    /** Nothing was written. `retained` stays on `past` and stays retryable. */
    | { readonly status: 'conflict'; readonly retained: readonly UndoEntry[] };

/** Undoes a unit member by member, newest first. Used for every unit that is not
 *  an atomic action group: a single entry, or a group mixing callbacks, inert
 *  entries and actions, whose members can only be replayed one at a time. */
async function undoEntriesNewestFirst(entries: readonly UndoEntry[]): Promise<CandidateOutcome> {
    const undone: UndoEntry[] = [];

    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!;
        const outcome = await executeUndo({ entry, runExecuteAppAction: executeAppAction });

        if (outcome.status === 'inert') {
            continue;
        }
        if (outcome.status === 'conflict') {
            // Nothing was written for this entry, so it and every older member of
            // its unit stay on `past` and stay retryable.
            const retained = entries.slice(0, index + 1);
            return undone.length === 0
                ? { status: 'conflict', retained }
                : { status: 'undone', undone, retained, partialConflict: true };
        }

        undone.unshift(entry);
        if (outcome.status === 'committed') {
            return {
                status: 'undone',
                undone,
                retained: entries.slice(0, index),
                partialConflict: false,
                committedError: outcome.error,
            };
        }
    }

    return undone.length === 0
        ? { status: 'inert' }
        : { status: 'undone', undone, retained: [], partialConflict: false };
}

async function undoCandidate(candidate: UndoCandidate): Promise<CandidateOutcome> {
    if (!candidate.head.groupId || !isAtomicActionGroup(candidate.entries)) {
        return undoEntriesNewestFirst(candidate.entries);
    }

    const outcome = await executeActionGroupUndo(candidate.entries);
    if (outcome.status === 'conflict') {
        return { status: 'conflict', retained: candidate.entries };
    }
    if (outcome.status === 'inert') {
        return { status: 'inert' };
    }
    return {
        status: 'undone',
        undone: candidate.entries,
        retained: [],
        partialConflict: false,
        committedError: outcome.status === 'committed' ? outcome.error : undefined,
    };
}

type UndoSettleInput = {
    readonly initialPast: readonly UndoEntry[];
    /** The entry that headed `past` when the call began. */
    readonly headId: string;
    readonly retainedPast: readonly UndoEntry[];
};

type UndoCommitInput = UndoSettleInput & {
    readonly undoneEntries: readonly UndoEntry[];
};

function toUndoResult(headId: string, retainedPast: readonly UndoEntry[]): UndoResult {
    return { headConsumed: !retainedPast.some((entry) => entry.id === headId) };
}

function commitUndo({ initialPast, headId, retainedPast, undoneEntries }: UndoCommitInput): UndoResult {
    commitUndoTransition(initialPast, retainedPast, undoneEntries);
    return toUndoResult(headId, retainedPast);
}

/** Nothing was undone. Conflicted entries stay exactly where they were; only a
 *  purge of inert entries needs persisting so their wedge is gone. */
function settleWithoutUndo({ initialPast, headId, retainedPast }: UndoSettleInput): UndoResult {
    if (retainedPast.length !== initialPast.length) {
        commitUndoTransition(initialPast, retainedPast, []);
    }
    return toUndoResult(headId, retainedPast);
}

async function undoImpl(): Promise<UndoResult> {
    const stored = undoStore.value;
    if (!stored || stored.past.length === 0) {
        return { headConsumed: false };
    }
    const initial = normalizeSingletonUndoGroups(stored);
    if (initial !== stored) {
        undoStore.set(initial);
    }

    const initialPast = initial.past;
    const headId = initialPast[initialPast.length - 1]!.id;
    let past = initialPast;

    // Scan downwards until something is actually undone. Inert entries (action
    // entries without an `inverseAction`) are dropped along the way: undoing one
    // writes nothing, so they must never wedge the undoable entries beneath them.
    //
    // A conflict ends the scan instead. Whether an inverse can refuse to write
    // against a diverged document is a property of the handler it runs, not of
    // the entry, and it is not visible from `UndoEntry` — so the entries beneath
    // cannot be filtered for safety, and running one risks overwriting the very
    // edit that caused the conflict. A blocked history is recoverable; a
    // clobbered edit is not. See #2881 for the capability this needs.
    for (;;) {
        const candidate = takeCandidate(past);
        if (!candidate) {
            return settleWithoutUndo({ initialPast, headId, retainedPast: past });
        }
        past = candidate.below;

        const outcome = await undoCandidate(candidate);
        if (outcome.status === 'inert') {
            continue;
        }
        if (outcome.status === 'conflict') {
            notifyUndoConflict(undoEntryLabel(candidate.head));
            return settleWithoutUndo({
                initialPast,
                headId,
                retainedPast: [...past, ...outcome.retained],
            });
        }

        if (outcome.partialConflict) {
            notifyPartialGroupUndo(undoEntryLabel(candidate.head));
        }
        const result = commitUndo({
            initialPast,
            headId,
            retainedPast: [...past, ...outcome.retained],
            undoneEntries: outcome.undone,
        });
        if (outcome.committedError) {
            throw outcome.committedError;
        }
        return result;
    }
}

export function undo(): Promise<UndoResult> {
    return runUndoRedoExclusive(undoImpl);
}
