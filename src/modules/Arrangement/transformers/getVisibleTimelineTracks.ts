import { type Track } from '../models/Track';

import { filterTracksShownInViews } from './filterTracksShownInViews';

export function getVisibleTimelineTracks(tracks: readonly Track[], showHiddenTracks = false): Track[] {
    const collapsedFolders = new Set(
        tracks.filter((track) => track.kind === 'folder' && track.collapsed).map((track) => track.id)
    );

    return filterTracksShownInViews(tracks, showHiddenTracks).filter((track) => {
        if (track.kind === 'master') {
            return false;
        }
        if (!track.parentId) {
            return true;
        }
        return !collapsedFolders.has(track.parentId);
    });
}
