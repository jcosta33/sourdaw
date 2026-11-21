import { filterTracksShownInViews } from '../transformers/filterTracksShownInViews';

type ViewTrack = {
    id: string;
    kind: string;
    parentId: string | null;
    hidden: boolean;
};

/** The tracks the arrangement rows and the mixer channels show, given whether the session shows hidden tracks. */
export function getTracksShownInViews<TTrack extends ViewTrack>(
    tracks: readonly TTrack[],
    showHiddenTracks: boolean
): TTrack[] {
    return filterTracksShownInViews(tracks, showHiddenTracks);
}
