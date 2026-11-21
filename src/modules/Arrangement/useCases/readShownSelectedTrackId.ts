import { trackStore } from '../stores/trackStore';

import { getTracksShownInViews } from './getTracksShownInViews';
import { readShowHiddenTracks } from './timelineEditing/readShowHiddenTracks';

/** The selected track, unless the views leave it out: a hidden selected track is not a drop target. */
export function readShownSelectedTrackId(): string | null {
    const state = trackStore.value;
    const selectedTrackId = state?.selectedTrackId ?? null;
    if (!state || selectedTrackId === null) {
        return null;
    }
    const shown = getTracksShownInViews(state.tracks, readShowHiddenTracks());
    return shown.some((track) => track.id === selectedTrackId) ? selectedTrackId : null;
}
