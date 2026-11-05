import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { audioClipSourceEndBeat } from './audioClipSourceEndBeat';

/**
 * The end a user's request to move a clip's end to `requestedEndBeat` may
 * reach. A non-looping audio clip grows at most to the beat its source runs out
 * on, as an unlooped region does in Logic, Pro Tools and Ableton; a clip
 * already past that beat does not grow. Shortening, looping and MIDI clips, and
 * a clip whose decoded source is not cached, keep the requested end.
 *
 * The bound belongs where a request is formed, never in `trimClipEnd`: undo,
 * redo and replay write the recorded end exactly, whatever the source and the
 * buffer cache say at that moment.
 */
export function limitClipEndToSource(
    clip: Clip,
    requestedEndBeat: number,
    timeline: TempoTimeline = liveTempoTimeline
): number {
    if (requestedEndBeat <= clip.endBeat || clip.audioBufferId === undefined) {
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
