import { captureAudioSourceState, getAudioTimelineElapsedSeconds } from '#/utils/audioSourceTime';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

/**
 * The beat at which a non-looping audio clip's source runs out. Playback reads
 * source second `E + r * (song seconds since the clip start)`, so a source of
 * `D` seconds is used up `(D - E) / r` song seconds after the clip start, read
 * back as a beat through the tempo map's own inverse. A negative entry (the
 * clip opening in silence before its media) lengthens that span by the
 * pre-roll it plays first.
 *
 * `null` when the clip has no such end (a MIDI or looping clip) or its source
 * position cannot be read.
 */
export function audioClipSourceEndBeat(
    clip: Clip,
    sourceDurationSeconds: number,
    timeline: TempoTimeline
): number | null {
    if (clip.type !== 'audio' || clip.loopEnabled || !hasExactAudioSourceFields(clip)) {
        return null;
    }
    if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) {
        return null;
    }
    const source = captureAudioSourceState(clip, clip.endBeat - clip.startBeat, timeline.tempoAtBeat(clip.startBeat));
    if (!source) {
        return null;
    }
    const remainingSongSeconds = getAudioTimelineElapsedSeconds(
        source.audioOffsetSeconds,
        sourceDurationSeconds,
        consumedStretchFactor(clip)
    );
    const endBeat = timeline.beatAtSeconds(timeline.secondsAtBeat(clip.startBeat) + remainingSongSeconds);
    return Number.isFinite(endBeat) ? endBeat : null;
}
