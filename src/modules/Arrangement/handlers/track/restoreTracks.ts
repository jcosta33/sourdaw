import { createHandler } from '#/utils/createHandler';
import { type HandlerAfterCommit } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { handleRestoreTrack } from '../restore/handleRestoreTrack';

/**
 * Inverse-action handler for `removeAllTracks`. Replays one `restoreTrack` snapshot
 * per removed track through the same restore logic `restoreTrack` itself uses, so the
 * whole arrangement returns as a single undo unit.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRestoreTracks = createHandler<'restoreTracks'>({
    execute: (action) => {
        const { restores } = action.payload;
        if (restores.length === 0) {
            return { status: 'no-write' };
        }

        // Restore ascending by the index each track held: a parent folder must exist
        // before a child references it, and each track lands back at its own slot.
        // Sort defensively rather than trusting the payload's order.
        const ordered = [...restores].sort((first, second) => first.trackIndex - second.trackIndex);

        const state = getTrackStoreState();
        if (!state) {
            return { status: 'conflict' };
        }
        // State diverged if any restored track already exists — re-adding it would
        // duplicate it. Check the whole batch up front so a mid-batch conflict never
        // leaves a partial write behind.
        const alreadyPresent = ordered.some((restore) => state.tracks.some((track) => track.id === restore.trackId));
        if (alreadyPresent) {
            return { status: 'conflict' };
        }

        // Every sibling in the batch, so `restoreTrack` skips the current-state check
        // on routing patches that target another track being restored in this same
        // batch — that track does not exist yet either.
        const batchRestoreTracks = ordered.map((restore) => ({
            trackId: restore.trackId,
            trackIndex: restore.trackIndex,
        }));

        const afterCommits: HandlerAfterCommit[] = [];
        const afterAmbiguousCommits: HandlerAfterCommit[] = [];
        for (const restore of ordered) {
            const result = handleRestoreTrack.execute({
                type: 'restoreTrack',
                payload: { ...restore, batchRestoreTracks },
            });
            // `restoreTrack` writes synchronously today. Awaiting here instead would put
            // an `await` between two CRDT writes, dropping the later ones out of this
            // action's Automerge transaction — so a thenable is refused loudly rather
            // than silently splitting the batch across transactions.
            if (!result || result instanceof Promise) {
                return { status: 'conflict' };
            }
            if (result.status !== 'written') {
                return { status: 'conflict' };
            }
            // Collected independently: a restore carrying only one of the two effects
            // would have both dropped by a combined check.
            if (result.afterCommit) {
                afterCommits.push(result.afterCommit);
            }
            if (result.afterAmbiguousCommit) {
                afterAmbiguousCommits.push(result.afterAmbiguousCommit);
            }
        }

        return {
            status: 'written',
            afterCommit: () => runAllAsyncEffects(afterCommits),
            afterAmbiguousCommit: () => runAllAsyncEffects(afterAmbiguousCommits),
        };
    },
    describe: () => ({ label: 'Restore all tracks', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
