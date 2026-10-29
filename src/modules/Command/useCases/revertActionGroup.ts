import { AppActionConflictError } from '../errors/AppActionExecutionError';
import { isActionEntry, type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { commitRevertedEntries } from './commitRevertedEntries';
import { executeAppAction, type ExecuteAppActionOptions } from './executeAppAction';
import { getLegacyTrimInverseReplayFailure } from './getLegacyTrimInverseReplayFailure';
import { isAppActionCommittedError } from './isAppActionCommittedError';
import { normalizeLegacyLoopAnchorInverse } from './normalizeLegacyLoopAnchorInverse';
import { runUndoRedoExclusive } from './undoRedo';

/**
 * Undo a single undo entry, returning whether anything was actually undone. An
 * action entry with no `inverseAction` cannot be undone — see `undoRedo`'s
 * `executeUndo` for why a non-undoable entry must not be consumed.
 *
 * The inverse is an internal replay driven by the undo engine, so it must not
 * commit its own undo entry or appear in an active macro recording. It goes
 * through the same legacy-anchor normalization seam the `undo` paths use
 * (#5198): a keyless legacy trim/loop/slip inverse in a persisted group must
 * restore anchorless — a slip's captured offset verbatim, rows unmoved — not
 * replay the fresh-action mint or wrap laws.
 */
async function revertEntry(entry: UndoEntry, authorizeFirstHandler?: () => string | null): Promise<boolean> {
    if (entry.kind === 'callback') {
        entry.undo();
        return true;
    }
    if (entry.inverseAction) {
        const options: ExecuteAppActionOptions = {
            undoEntryId: entry.id,
            skipUndo: true,
            skipMacroRecording: true,
        };
        if (authorizeFirstHandler) {
            options.authorizeFirstHandler = authorizeFirstHandler;
        }
        await executeAppAction(normalizeLegacyLoopAnchorInverse(entry.inverseAction), options);
        return true;
    }
    return false;
}

/**
 * Revert every undo entry tagged with `groupId`, owning the undo-store write
 * inside the Command module. Used by AiRuntime to revert an AI action group
 * without reconstructing the past/future split — and the undo-tree position —
 * by hand. The entries are undone newest-first, removed from `past`, and pushed
 * onto `future` so a redo re-applies them in order.
 */
async function revertActionGroupImpl(groupId: string): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }

    const groupEntries = state.past.filter((entry) => entry.groupId === groupId);
    if (groupEntries.length === 0) {
        return;
    }

    const hasLegacyTrim = groupEntries.some(
        (entry) =>
            isActionEntry(entry) &&
            entry.inverseAction?.type === 'trimClipStart' &&
            entry.inverseAction.payload.midiOffsetBeats === undefined
    );
    if (hasLegacyTrim && groupEntries.some((entry) => !isActionEntry(entry))) {
        throw new AppActionConflictError('trimClipStart', 'A callback prefix cannot prove the legacy trim coordinates');
    }

    const revertedEntries: UndoEntry[] = [];
    let failure: unknown;
    for (let index = groupEntries.length - 1; index >= 0; index--) {
        const entry = groupEntries[index]!;
        try {
            const remainingInverses = groupEntries
                .slice(0, index + 1)
                .reverse()
                .flatMap((candidate) =>
                    isActionEntry(candidate) && candidate.inverseAction ? [candidate.inverseAction] : []
                );
            let authorizeReplay: (() => string | null) | undefined;
            if (hasLegacyTrim) {
                authorizeReplay = () => getLegacyTrimInverseReplayFailure(remainingInverses);
            }
            if (await revertEntry(entry, authorizeReplay)) {
                revertedEntries.unshift(entry);
            }
        } catch (error) {
            if (isAppActionCommittedError(error)) {
                revertedEntries.unshift(entry);
            }
            failure = error;
            break;
        }
    }

    commitRevertedEntries(revertedEntries);
    if (failure !== undefined) {
        throw failure instanceof Error ? failure : new Error('Action group revert failed', { cause: failure });
    }
}

export function revertActionGroup(groupId: string): Promise<void> {
    return runUndoRedoExclusive(() => revertActionGroupImpl(groupId));
}
