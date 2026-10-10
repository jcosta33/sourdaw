import { createHandler } from '#/utils/createHandler';
import { type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';
import { runAllEffects } from '#/utils/runEffects';

import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

function isRestoreSnapshot(value: RestoreTrackPayloadSnapshot | null): value is RestoreTrackPayloadSnapshot {
    return value !== null;
}

export const handleRemoveAllTracks = createHandler<'removeAllTracks'>({
    execute: () => {
        const state = getTrackStoreState();
        if (!state || state.tracks.length === 0) {
            return { status: 'no-write' };
        }
        // #5090 — the single-track handler sweeps modulation ownership
        // separately from removeTrack; the bulk route must do the same, or the
        // serialized document keeps modulators and target mappings naming
        // deleted tracks. Runtime effects stay deferred to the commit so a
        // refused or ambiguous transaction retains the prior modulation truth
        // and its runtime, exactly like handleRemoveTrack.
        const modulationRemovals = state.tracks.map((time) => {
            removeTrack(time.id);
            return removeTrackModulationReferences({ trackId: time.id, deferRuntimeEffects: true });
        });
        return {
            status: 'written',
            afterCommit: () => runAllEffects(modulationRemovals.map((removal) => removal.afterCommit)),
            afterAmbiguousCommit: () =>
                runAllEffects(modulationRemovals.map((removal) => removal.afterAmbiguousCommit)),
        };
    },
    describe: (alpha) => {
        // Capture every live track before execute deletes them, in track order, so the
        // whole arrangement comes back as one undo unit rather than N separate undos.
        const tracks = getTrackStoreState()?.tracks ?? [];
        if (tracks.length === 0) {
            return { label: 'Remove all tracks', inverseAction: null };
        }
        const restores = tracks.map((track) => captureTrackRemovalSnapshot(track.id)).filter(isRestoreSnapshot);
        return {
            label: 'Remove all tracks',
            inverseAction: { type: 'restoreTracks', payload: { restores } },
            redoAction: alpha,
        };
    },
    isNoop: () => (getTrackStoreState()?.tracks.length ?? 0) === 0,
    undoable: true,
});
