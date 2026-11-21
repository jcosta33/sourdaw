import { type Track } from '../models/Track';

import { getTracksShownInViews } from './getTracksShownInViews';
import { setShowHiddenTracks } from './timelineEditing/setShowHiddenTracks';

/**
 * Makes sure the views draw a track the user chose or a command targets: when
 * the track or an ancestor folder is hidden, hidden tracks are shown for the
 * session. The track itself stays hidden.
 */
export function revealTrackInViews(tracks: readonly Track[], trackId: string): void {
    if (getTracksShownInViews(tracks, false).some((shown) => shown.id === trackId)) {
        return;
    }
    setShowHiddenTracks(true);
}
