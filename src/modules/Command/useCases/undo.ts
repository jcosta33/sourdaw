import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionCommittedError, AppActionConflictError } from '../errors/AppActionExecutionError';
import { isActionEntry, type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { executeAppActionBatch } from './executeAppActionBatch';
import { getCommandHandler } from './getCommandHandler';
import { getProjectMutationAdmissionFailure } from './isProjectMutationAllowed';
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

function notifySkippedUndoConflict(skippedLabel: string, undoneLabel: string): void {
    notifyUser(`Skipped "${skippedLabel}": project state has changed; undid "${undoneLabel}"`, 'warning');
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

/** One member of a step target: an action entry whose inverse resolves to a
 *  handler that declares `canReportConflict`. */
function isStepOverCapableMember(entry: UndoEntry): boolean {
    if (!isActionEntry(entry) || entry.inverseAction === null) {
        return false;
    }
    return getCommandHandler(entry.inverseAction)?.canReportConflict === true;
}

/**
 * Whether undo may step over one conflicted unit onto the candidate beneath it
 * (#2881). Guardedness is a property of the HANDLER an inverse will run, not of
 * the undo entry: `executeAppAction` never calls `handler.validate`, and many
 * undoable handlers route through `toHandlerExecutionResult` (`no-write` |
 * `written`) and can never refuse. So the step is admitted only when EVERY
 * member is an action entry whose `inverseAction` resolves to a handler that
 * declares `canReportConflict` — one whose `execute` can genuinely return
 * `{ status: 'conflict' }`. A callback member reports success unconditionally,
 * an unflagged handler cannot refuse, and a missing handler resolves to
 * nothing, so stepping onto any of them could silently overwrite the very edit
 * that caused the conflict. Between a blocked history and a clobbered edit,
 * blocked is recoverable.
 */
function canStepOverConflictOnto(candidate: UndoCandidate): boolean {
    return candidate.entries.every(isStepOverCapableMember);
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

/**
 * Whether the scan would drop this unit without running anything: every member
 * is an action entry without an `inverseAction`. A mixed unit still has a
 * member that writes (or a callback that runs), so only a fully inert unit can
 * be purged ahead of a blocked undo.
 */
function isInertUnit(candidate: UndoCandidate): boolean {
    return candidate.entries.every((entry) => isActionEntry(entry) && entry.inverseAction === null);
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

type StepOverInput = {
    readonly initialPast: readonly UndoEntry[];
    readonly headId: string;
    /** The conflicted unit's head entry, which names it in the skip notification. */
    readonly conflictedHead: UndoEntry;
    /** The conflicted unit's entries, which stay on `past` at the head, retryable. */
    readonly retained: readonly UndoEntry[];
    /** `past` beneath the conflicted unit. */
    readonly beneath: readonly UndoEntry[];
};

/**
 * One conflicted unit no longer wedges the whole history behind it (#2881): a
 * single step onto the unit directly beneath is attempted, gated by
 * `canStepOverConflictOnto`, and nothing further. One keystroke touches at most
 * two units (the conflicted head attempted, one step target undone) and emits at
 * most two notifications (the conflict message plus the skip summary) — never an
 * unbounded scan. The conflicted unit stays at the head of `past`, retryable, so
 * `headConsumed` stays `false` and history sweeps still stop on it.
 */
async function stepOverConflictedHeadOrSettle({
    initialPast,
    headId,
    conflictedHead,
    retained,
    beneath,
}: StepOverInput): Promise<UndoResult> {
    const next = takeCandidate(beneath);
    if (!next || !canStepOverConflictOnto(next)) {
        return settleWithoutUndo({ initialPast, headId, retainedPast: [...beneath, ...retained] });
    }

    const outcome = await undoCandidate(next);
    if (outcome.status === 'conflict') {
        // The step target refused too. Nothing was written by either unit, both
        // stay on `past` retryable, and the conflict notification already
        // reported the blocked undo. No third unit is touched.
        return settleWithoutUndo({
            initialPast,
            headId,
            retainedPast: [...next.below, ...outcome.retained, ...retained],
        });
    }
    if (outcome.status === 'inert') {
        // Unreachable — the gate admits only members carrying an inverse — but
        // dropping an inert unit here matches the scan's own inert purge.
        return settleWithoutUndo({ initialPast, headId, retainedPast: [...next.below, ...retained] });
    }

    // The gate admits only all-flagged atomic groups and single flagged entries,
    // so a partial conflict inside the step target cannot arise.
    notifySkippedUndoConflict(undoEntryLabel(conflictedHead), undoEntryLabel(next.head));
    const result = commitUndo({
        initialPast,
        headId,
        retainedPast: [...next.below, ...outcome.retained, ...retained],
        undoneEntries: outcome.undone,
    });
    if (outcome.committedError) {
        throw outcome.committedError;
    }
    return result;
}

async function undoImpl(stepOverConflicts: boolean): Promise<UndoResult> {
    const stored = undoStore.value;
    if (!stored || stored.past.length === 0) {
        return { headConsumed: false };
    }
    const initial = normalizeSingletonUndoGroups(stored);
    if (initial !== stored) {
        undoStore.set(initial);
    }

    const initialPast: readonly UndoEntry[] = initial.past;
    const headId = initialPast[initialPast.length - 1]!.id;
    let past: readonly UndoEntry[] = initialPast;

    // Drop fully inert head units before anything can refuse (#2881): undoing
    // one writes nothing, and a dead row left above a blocked undo would hide
    // the real head's label from the notification that reports it.
    while (past.length > 0) {
        const inertHead = takeCandidate(past);
        if (!inertHead || !isInertUnit(inertHead)) {
            break;
        }
        past = inertHead.below;
    }

    // While project mutation admission fails, every inverse would refuse on
    // admission alone before any handler runs, so attempting one — or stepping
    // past one — is pointless churn. Report the blocked undo once, named after
    // the first real head, and stop.
    if (getProjectMutationAdmissionFailure() !== null) {
        if (past.length > 0) {
            notifyUndoConflict(undoEntryLabel(past[past.length - 1]!));
        }
        return settleWithoutUndo({ initialPast, headId, retainedPast: past });
    }

    // Scan downwards until something is actually undone. Fully inert units were
    // already purged above, so every candidate left here has at least one
    // member that writes, runs, or refuses; the inert arm below stays only as a
    // defensive stop for a mixed unit whose writable members all turn out
    // no-write.
    //
    // A conflict no longer wedges everything beneath it (#2881) — for the
    // keystroke entry point. The conflicted unit stays retained at the head of
    // `past` — retryable, with `headConsumed: false` — and undo attempts
    // exactly one unit beneath it, and only when every member's inverse
    // resolves to a handler that declares `canReportConflict`: a handler whose
    // `execute` can genuinely refuse to write against a diverged document.
    // Handlers routed through `toHandlerExecutionResult` and callback entries
    // can never refuse, so stepping onto them could silently overwrite the very
    // edit that caused the conflict; the wedge above those runs is deliberate —
    // #2881's own limit, and between a blocked history and a clobbered edit,
    // blocked is recoverable. Anchor-targeted history sweeps
    // (`undoToIndex`, via `stepOverConflicts: false`) never step: their target
    // row names the entry the user clicked to KEEP, so a step there would undo
    // the row the sweep was pointed at. #2878 mirrors this for redo; see #3641
    // for the callback arc.
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
            if (!stepOverConflicts) {
                return settleWithoutUndo({
                    initialPast,
                    headId,
                    retainedPast: [...past, ...outcome.retained],
                });
            }
            return stepOverConflictedHeadOrSettle({
                initialPast,
                headId,
                conflictedHead: candidate.head,
                retained: outcome.retained,
                beneath: past,
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

export type UndoOptions = {
    /**
     * Whether one keystroke may step over a conflicted head onto a
     * conflict-capable unit beneath it (#2881). Defaults to `true` — every
     * user-driven entry point (keyboard, menu, buttons, commands) wants the
     * step. Anchor-targeted history sweeps pass `false`: the row they target
     * names the entry to STOP at, so stepping past a conflicted head there
     * would undo the row the user clicked to keep.
     */
    readonly stepOverConflicts?: boolean;
};

export function undo(options: UndoOptions = {}): Promise<UndoResult> {
    return runUndoRedoExclusive(() => undoImpl(options.stepOverConflicts ?? true));
}
