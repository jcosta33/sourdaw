import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { audioClipSourceEndBeat } from './audioClipSourceEndBeat';
import { canBeLimitedToSource } from './canBeLimitedToSource';

/**
 * The end a request to move a clip's end to `requestedEndBeat` may write. A
 * non-looping audio clip grows at most to the beat its source runs out on, as
 * an unlooped region does in Logic, Pro Tools and Ableton; a clip already past
 * that beat does not grow. Shortening, looping and MIDI clips, and a clip
 * whose decoded source is not cached, keep the requested end.
 */
export function limitClipEndToSource(
    clip: Clip,
    requestedEndBeat: number,
    timeline: TempoTimeline = liveTempoTimeline
): number {
    if (requestedEndBeat <= clip.endBeat || !canBeLimitedToSource(clip)) {
        return requestedEndBeat;
    }
    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return requestedEndBeat;
    }
    const sourceEndBeat = audioClipSourceEndBeat(clip, buffer.length / buffer.sampleRate, timeline);
    if (sourceEndBeat === null || requestedEndBeat - sourceEndBeat <= CLIP_LOOP_WINDOW_BEAT_TOLERANCE) {
        return requestedEndBeat;
    }
    return Math.max(clip.endBeat, sourceEndBeat);
}
