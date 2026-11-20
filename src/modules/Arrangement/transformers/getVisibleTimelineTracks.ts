import { type Track } from '../models/Track';

export function getVisibleTimelineTracks(tracks: readonly Track[]): Track[] {
    const collapsedFolders = new Set(
        tracks.filter((track) => track.kind === 'folder' && track.collapsed).map((track) => track.id)
    );

    return tracks.filter((track) => {
        if (track.kind === 'master') {
            return false;
        }
        if (!track.parentId) {
            return true;
        }
        return !collapsedFolders.has(track.parentId);
    });
}
