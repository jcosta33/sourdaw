import { createHandler } from '#/utils/createHandler';
import { type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';

import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';

function isRestoreSnapshot(value: RestoreTrackPayloadSnapshot | null): value is RestoreTrackPayloadSnapshot {
    return value !== null;
}

export const handleRemoveAllTracks = createHandler<'removeAllTracks'>({
    execute: () => {
        const state = getTrackStoreState();
        if (state) {
            for (const time of state.tracks) {
                removeTrack(time.id);
            }
        }
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
