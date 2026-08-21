import { createHandler } from '#/utils/createHandler';
import { type FreezeStateSnapshot } from '#/utils/handlerContract';

import { captureFreezeStateSnapshot } from '../../useCases/freezeBounce/freezeStateSnapshot';
import { freezeTrack } from '../../useCases/freezeBounce/freezeTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type MutableFreezeStateSnapshot = {
    frozen: boolean;
    frozenBufferId?: string;
    freezeState: FreezeStateSnapshot['freezeState'];
};

// The take this action produces is only fully known after the offline render: the content
// hash, the pinned compensation and the render settings all come out of it. `describe()`
// runs before `execute()`, so it emits the post-state object empty and `execute()` fills
// it in once the render lands — the same describe-then-finalize pattern `handleAddTrack`
// uses to guard its discard inverse. Keyed by action so concurrent freezes cannot cross.
const pendingFreezeSnapshots = new WeakMap<object, MutableFreezeStateSnapshot>();

export const handleFreezeTrack = createHandler<'freezeTrack'>({
    execute: async (action) => {
        const didWrite = await freezeTrack(action.payload.trackId, action.payload.freezeId);
        if (didWrite) {
            const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
            const pending = pendingFreezeSnapshots.get(action);
            if (track && pending) {
                const settled = captureFreezeStateSnapshot(track);
                pending.frozen = settled.frozen;
                pending.frozenBufferId = settled.frozenBufferId;
                pending.freezeState = settled.freezeState;
            }
        }
        return toHandlerExecutionResult(didWrite);
    },
    describe: (action) => {
        // `unfreezeTrack` is not a complete inverse. Freeze also accepts `stale` and
        // `error` states, and those can already carry a buffer — a bare unfreeze clears it
        // and collapses the metadata to `unfrozen`, which is not where the action started.
        // Capture the whole aggregate on both sides instead.
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const freezeId = action.payload.freezeId;
        if (!track || !freezeId) {
            return { label: 'Freeze track', inverseAction: null };
        }
        const previous = captureFreezeStateSnapshot(track);
        // Seeded with the identity this run will mint so the guard is meaningful even if
        // the render never completes; `execute()` replaces it with the settled take.
        const settled: MutableFreezeStateSnapshot = {
            frozen: true,
            frozenBufferId: freezeId,
            freezeState: { status: 'frozen', freezeId, frozenBufferId: freezeId },
        };
        pendingFreezeSnapshots.set(action, settled);
        return {
            label: 'Freeze track',
            inverseAction: {
                type: 'restoreFreezeState',
                payload: { trackId: track.id, expected: settled, replacement: previous },
            },
            // Redo restores the take this run produced rather than re-entering the async
            // freeze. Re-running it would render a second time and mint a different
            // buffer, and its post-`await` writes would land after the command transaction
            // closed — so the final freeze state could commit on its own frame, separately
            // from the redo stack advancing.
            redoAction: {
                type: 'restoreFreezeState',
                payload: { trackId: track.id, expected: previous, replacement: settled },
            },
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.freezeState.status ===
        'frozen',
    undoable: true,
});
