type HideableTrack = {
    id: string;
    kind: string;
    parentId: string | null;
    hidden: boolean;
};

function hasHiddenAncestor(track: HideableTrack, tracksById: ReadonlyMap<string, HideableTrack>): boolean {
    const visited = new Set<string>([track.id]);
    let parentId = track.parentId;
    while (parentId !== null && !visited.has(parentId)) {
        const parent = tracksById.get(parentId);
        if (!parent) {
            return false;
        }
        if (parent.hidden) {
            return true;
        }
        visited.add(parentId);
        parentId = parent.parentId;
    }
    return false;
}

/**
 * The one rule for which tracks the arrangement rows and the mixer channels
 * show. `hidden` is a view property only: a hidden track, and every descendant
 * of a hidden folder, is left out unless the session shows hidden tracks. The
 * master is never hidden.
 */
export function filterTracksShownInViews<TTrack extends HideableTrack>(
    tracks: readonly TTrack[],
    showHiddenTracks: boolean
): TTrack[] {
    if (showHiddenTracks) {
        return [...tracks];
    }
    const tracksById = new Map<string, HideableTrack>(tracks.map((track) => [track.id, track]));
    return tracks.filter(
        (track) => track.kind === 'master' || (!track.hidden && !hasHiddenAncestor(track, tracksById))
    );
}
