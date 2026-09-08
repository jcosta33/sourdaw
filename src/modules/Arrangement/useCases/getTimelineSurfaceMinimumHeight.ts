import { type Track } from '../models/Track';
import { getTimelineTrackHeight, getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

export function getTimelineSurfaceMinimumHeight(tracks: readonly Track[], selectedTrackId: string | null): number {
    const visibleTracks = getVisibleTimelineTracks(tracks);
    const selectedTrack = visibleTracks.find((track) => track.id === selectedTrackId && track.kind !== 'folder');
    if (selectedTrack) {
        return getTimelineTrackHeight(selectedTrack);
    }

    const firstNonFolderTrack = visibleTracks.find((track) => track.kind !== 'folder');
    if (firstNonFolderTrack) {
        return getTimelineTrackHeight(firstNonFolderTrack);
    }

    const firstVisibleTrack = visibleTracks[0];
    return firstVisibleTrack ? getTimelineTrackHeight(firstVisibleTrack) : 0;
}
