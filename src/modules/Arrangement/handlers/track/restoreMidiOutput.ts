import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

/**
 * Inverse of `setMidiOutput` and `clearMidiOutput`, guarded against a newer routing
 * change. Only ever dispatched as an inverse or redo action (with `skipUndo`) from the
 * undo engine, so it is not itself undoable.
 */
export const handleRestoreMidiOutput = createHandler<'restoreMidiOutput'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track || track.midiOutputTrackId !== action.payload.expected) {
            return { status: 'conflict' };
        }
        if (track.midiOutputTrackId === action.payload.replacement) {
            return { status: 'no-write' };
        }
        updateTrack(track.id, (candidate) => ({ ...candidate, midiOutputTrackId: action.payload.replacement }));
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore MIDI output routing', inverseAction: null }),
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.midiOutputTrackId ===
        action.payload.replacement,
    undoable: false,
});
