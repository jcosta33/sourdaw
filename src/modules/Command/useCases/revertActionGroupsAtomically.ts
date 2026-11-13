import { type ExecuteOptions } from '#/utils/handlerContract';

import { type AppActionCommittedError } from '../errors/AppActionExecutionError';
import { isActionEntry, type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { commitRevertedEntries } from './commitRevertedEntries';
import { executeActionGroupUndo } from './executeActionGroupUndo';
import { runUndoRedoExclusive } from './undoRedo';

/** What a whole-group revert did: undid every entry of the group, or wrote nothing and says why. */
export type AtomicActionGroupRevert =
    | { status: 'reverted'; warning: string | null }
    | { status: 'refused'; reason: 'not-applied' | 'not-replayable' | 'conflict'; detail: string };

/** The batch's own warning, which the committed error carries as its cause beneath a generic message. */
function readCommittedWarning(error: AppActionCommittedError): string {
    return error.cause instanceof Error ? error.cause.message : error.message;
}

export type AtomicActionGroupRevertOptions = Pick<ExecuteOptions, 'shouldExecute'>;

function isMemberOf(groupIds: ReadonlySet<string>, entry: UndoEntry): boolean {
    return entry.groupId !== undefined && groupIds.has(entry.groupId);
}

/** Every group stands in `past` and none has a member in `future`: each is applied whole. */
function holdsEveryGroupApplied(
    groupIds: ReadonlySet<string>,
    entries: readonly UndoEntry[],
    future: readonly UndoEntry[]
): boolean {
    return (
        groupIds.size > 0 &&
        [...groupIds].every((groupId) => entries.some((entry) => entry.groupId === groupId)) &&
        !future.some((entry) => isMemberOf(groupIds, entry))
    );
}

async function revertActionGroupsAtomicallyImpl(
    requestedGroupIds: readonly string[],
    options: AtomicActionGroupRevertOptions | undefined
): Promise<AtomicActionGroupRevert> {
    const state = undoStore.value;
    const groupIds = new Set(requestedGroupIds);
    const entries = (state?.past ?? []).filter((entry) => isMemberOf(groupIds, entry));
    if (!holdsEveryGroupApplied(groupIds, entries, state?.future ?? [])) {
        return {
            status: 'refused',
            reason: 'not-applied',
            detail: 'The undo history does not hold the group applied whole',
        };
    }
    if (!entries.every((entry) => isActionEntry(entry) && entry.inverseAction !== null)) {
        return {
            status: 'refused',
            reason: 'not-replayable',
            detail: 'Part of the group has no inverse command to replay',
        };
    }
    let historyFinalized = false;
    const finalizeHistory = () => {
        if (historyFinalized) {
            return;
        }
        // History follows publication before an asynchronous effect can clear it or a later
        // musician edit can invalidate its Redo, including an ambiguous publication's effects.
        historyFinalized = true;
        commitRevertedEntries(entries);
    };
    const outcome = await executeActionGroupUndo(entries, {
        ...options,
        onCommitted: finalizeHistory,
        onAmbiguousCommit: finalizeHistory,
    });
    if (outcome.status === 'conflict') {
        return {
            status: 'refused',
            reason: 'conflict',
            detail: outcome.reason ?? 'The project state has changed since the group was applied',
        };
    }
    if (outcome.status === 'inert') {
        return {
            status: 'refused',
            reason: 'not-replayable',
            detail: 'Part of the group has no inverse command to replay',
        };
    }
    if (!historyFinalized) {
        // No-op replay still yields. It may consume history only while the caller's project
        // authority and the untouched history snapshot both remain current.
        if (options?.shouldExecute && !options.shouldExecute()) {
            return {
                status: 'refused',
                reason: 'conflict',
                detail: 'The project state has changed since the group was applied',
            };
        }
        if (undoStore.value !== state) {
            return {
                status: 'refused',
                reason: 'not-applied',
                detail: 'The undo history changed before the group could be reverted',
            };
        }
        finalizeHistory();
    }
    return { status: 'reverted', warning: outcome.status === 'committed' ? readCommittedWarning(outcome.error) : null };
}

/**
 * Revert several groups as ONE atomic replay, under the same rules as `revertActionGroupAtomically`
 * applied to them together: every group must stand in `past` whole and every member must carry an
 * inverse, and all their entries replay in one batch, newest-first across the groups, so nothing is
 * written unless every inverse of every group applies. Looping the single-group revert instead would
 * leave the groups it reached first undone when a later one refuses.
 */
export function revertActionGroupsAtomically(
    groupIds: readonly string[],
    options?: AtomicActionGroupRevertOptions
): Promise<AtomicActionGroupRevert> {
    return runUndoRedoExclusive(() => revertActionGroupsAtomicallyImpl(groupIds, options));
}
