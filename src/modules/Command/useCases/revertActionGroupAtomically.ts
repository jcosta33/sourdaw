import { isActionEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { commitRevertedEntries } from './commitRevertedEntries';
import { executeActionGroupUndo } from './executeActionGroupUndo';
import { runUndoRedoExclusive } from './undoRedo';

/** What a whole-group revert did: undid every entry of the group, or wrote nothing and says why. */
type AtomicActionGroupRevert =
    | { status: 'reverted'; warning: string | null }
    | { status: 'refused'; reason: 'not-applied' | 'not-replayable' | 'conflict'; detail: string };

async function revertActionGroupAtomicallyImpl(groupId: string): Promise<AtomicActionGroupRevert> {
    const state = undoStore.value;
    const entries = (state?.past ?? []).filter((entry) => entry.groupId === groupId);
    if (entries.length === 0 || (state?.future ?? []).some((entry) => entry.groupId === groupId)) {
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
    const outcome = await executeActionGroupUndo(entries);
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
    commitRevertedEntries(entries);
    return { status: 'reverted', warning: outcome.status === 'committed' ? outcome.error.message : null };
}

/**
 * Revert every undo entry tagged with `groupId` as ONE atomic replay, the one `undo()` gives a
 * group at the head of `past`, wherever the group sits in `past`. Unlike `revertActionGroup`, which
 * replays member by member and keeps whatever it undid before a member refuses, nothing is written
 * unless every inverse applies: a group not applied whole, one holding a member without an inverse
 * command, and one whose inverses conflict with the project as it is now are refused and stay
 * exactly where they were.
 */
export function revertActionGroupAtomically(groupId: string): Promise<AtomicActionGroupRevert> {
    return runUndoRedoExclusive(() => revertActionGroupAtomicallyImpl(groupId));
}
