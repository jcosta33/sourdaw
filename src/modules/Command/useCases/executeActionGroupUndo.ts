import { AppActionCommittedError } from '../errors/AppActionExecutionError';
import { isActionEntry, type UndoEntry } from '../models/UndoEntry';

import { executeAppActionBatch } from './executeAppActionBatch';
import { normalizeLegacyLoopAnchorInverse } from './normalizeLegacyLoopAnchorInverse';

/**
 * What happened when one entry's undo side-effect ran.
 *
 * Audit CC-6 — the replay path used to report a bare boolean and let every
 * rejection escape, which conflated the two `executeAppAction` failures. They
 * demand opposite stack handling: a conflict wrote nothing (retry later), a
 * committed error already wrote (never replay it again).
 */
export type UndoOutcome =
    /** The inverse was applied. */
    | { readonly status: 'undone' }
    /** No `inverseAction`: undoing is a no-op, so the entry is dropped. */
    | { readonly status: 'inert' }
    /** The transaction aborted; nothing was written and the entry stands. */
    | { readonly status: 'conflict'; readonly reason?: string }
    /** The write landed but its bookkeeping failed; the stack must advance. */
    | { readonly status: 'committed'; readonly error: AppActionCommittedError };

/**
 * Replays one group's inverses as ONE atomic batch, newest-first (#3814
 * contract). The batch preflight therefore validates each inverse against the
 * state its predecessor inverses produce — the same order the batch executes —
 * never against the live pre-batch state alone.
 *
 * Sequential singles sharing one `groupId` form heterogeneous groups
 * legitimately (a clip re-homing beside a clip-destroying track removal), and
 * a member whose predecessors restore its preconditions MUST pass preflight:
 * the batch's sequential execution gives member k the writes of members
 * 0..k-1, so a live-only preflight is strictly stricter than execution. A
 * preflight failure writes nothing and retains the group on `past`, and the
 * identical preflight fails identically on every retry — the group would be
 * permanently un-undoable. The inverse handlers close that gap by projecting
 * prior siblings (`projectClipThroughPriorBatchActions`,
 * `projectMidiNotesByClipIdThroughRestores`,
 * `projectTrackThroughPriorBatchActions`), mirroring the batch-aware
 * validation forward atomic batches already use.
 *
 * Honest refusal is untouched: state an external edit could have changed since
 * the group committed still fails the guards, the batch preflights `conflicted`
 * before any write, and the whole group stays on `past` retryable.
 */
export async function executeActionGroupUndo(entries: readonly UndoEntry[]): Promise<UndoOutcome> {
    if (!entries.every(isActionEntry) || entries.some((entry) => entry.inverseAction === null)) {
        return { status: 'inert' };
    }

    // Keyless legacy trim/loop/slip inverses normalize to the explicit
    // anchorless restoration before dispatch (#5198): their pre-action clips
    // were anchorless by construction, and replaying them through the
    // handlers' fresh-action mint laws would mint anchors the pre-action
    // state never carried — or, for a slip, re-wrap a captured offset the
    // forward law must never touch on a replay.
    const actions = [...entries].reverse().map((entry) => normalizeLegacyLoopAnchorInverse(entry.inverseAction!));
    const result = await executeAppActionBatch(actions, {
        skipUndo: true,
        skipMacroRecording: true,
        source: entries[0]?.source,
    });
    if (result.status === 'conflicted' || result.status === 'cancelled') {
        return { status: 'conflict', reason: result.reason };
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
