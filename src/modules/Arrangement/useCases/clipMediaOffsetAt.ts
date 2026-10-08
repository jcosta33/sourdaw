import { type TempoTimeline } from '../models/TakeLane';
import { type Clip } from '../stores/trackStore';

import { clipMediaOriginBeat } from './clipMediaOriginBeat';

/**
 * The media offset a fragment of `clip` starting at `beat` carries, so that
 * every reader enters the clip's own media at what sounds there.
 *
 * An audio reader converts a fragment's `audioOffsetBeats` to file seconds at
 * the tempo governing the fragment's own first beat, then plays on in real
 * time. So the offset is the clip's media seconds at `beat` — its entry seconds
 * at its own start, read the same way, plus the song time between the two
 * beats — converted at the tempo of `beat`. Adding timeline beats to the clip's
 * offset instead would seek wrong wherever the tempo changes between them.
 *
 * MIDI notes are placed in beats from the clip's media origin, so a MIDI
 * fragment's offset is plain beat distance from that origin.
 *
 * At the clip's own start it is the clip's own offset, exactly, so a fragment
 * there stays byte-identical to its source.
 */
export function clipMediaOffsetAt(clip: Clip, beat: number, timeline: TempoTimeline): number {
    if (beat === clip.startBeat) {
        return clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
    }
    if (clip.type !== 'audio') {
        return beat - clipMediaOriginBeat(clip);
    }
    const entrySeconds = ((clip.audioOffsetBeats ?? 0) * 60) / timeline.tempoAtBeat(clip.startBeat);
    const mediaSeconds = entrySeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(clip.startBeat);
    return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
}
