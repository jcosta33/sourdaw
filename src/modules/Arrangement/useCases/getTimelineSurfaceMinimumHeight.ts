import { type Preferences } from '#/modules/Preferences/stores';

import { getTimelineTrackHeight } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';
import { getTimelineTrackHeightScale } from '../stores/timelineTrackHeightPreference';
import { getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

export function getTimelineSurfaceMinimumHeight(
    tracks: readonly Track[],
    selectedTrackId: string | null,
    heightMode?: Preferences['trackHeight']
): number {
    const visibleTracks = getVisibleTimelineTracks(tracks);
    const track =
        visibleTracks.find((track) => track.id === selectedTrackId && track.kind !== 'folder') ??
        visibleTracks.find((track) => track.kind !== 'folder') ??
        visibleTracks[0];
    return track ? getTimelineTrackHeight(track, getTimelineTrackHeightScale(heightMode)) : 0;
}
