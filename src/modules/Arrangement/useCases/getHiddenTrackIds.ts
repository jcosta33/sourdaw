import { getTracksShownInViews } from './getTracksShownInViews';

type ViewTrack = {
    id: string;
    kind: string;
    parentId: string | null;
    hidden: boolean;
};

/** Tracks a view that draws every track should mark: hidden, or under a hidden folder. */
export function getHiddenTrackIds(tracks: readonly ViewTrack[]): Set<string> {
    const shownIds = new Set(getTracksShownInViews(tracks, false).map((track) => track.id));
    return new Set(tracks.filter((track) => !shownIds.has(track.id)).map((track) => track.id));
}
