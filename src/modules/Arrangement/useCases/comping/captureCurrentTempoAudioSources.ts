import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Track } from '../../models/Track';

import { captureDeferredTempoRecordings } from './captureDeferredTempoRecordings';
import { captureTempoAudioSources } from './captureTempoAudioSources';

/** An uncommitted recorder owns its future PCM basis. Its root-bound pass and
 * take witnesses defer capture; an ordinary missing/raw owner gets no exemption. */
export function captureCurrentTempoAudioSources(
    tracks: readonly Track[],
    lanes: readonly TakeLane[],
    timeline: TempoTimeline
) {
    const deferred = captureDeferredTempoRecordings(tracks, lanes).clipIds;
    if (deferred.size === 0) {
        return captureTempoAudioSources(tracks, lanes, timeline);
    }
    const sourceTracks = tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => !deferred.has(clip.id)),
    }));
    const sourceLanes = lanes.map((lane) => ({
        ...lane,
        takes: lane.takes.filter((take) => !deferred.has(take.clipId)),
    }));
    return captureTempoAudioSources(sourceTracks, sourceLanes, timeline);
}
