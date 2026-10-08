import { clipEntrySeconds, isTempoConstantBetween, type TempoTimeline } from '../models/TempoTimeline';
import { type Clip } from '../stores/trackStore';

/** A clip's own media offset, in the field its readers read. */
function clipOwnMediaOffset(clip: Clip): number {
    return clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
}

/**
 * The media offset a fragment of `clip` starting at `beat` carries, so that
 * every reader enters the clip's own media at what sounds there.
 *
 * Beats are added to the clip's own offset — main's arithmetic, exactly —
 * wherever that is right: always for MIDI, whose notes are placed in beats, and
 * for audio across a span no tempo change lies in. Across a tempo change an
 * audio reader, which converts a fragment's offset at the tempo of the
 * fragment's own first beat, needs the clip's media seconds at `beat` — its
 * entry seconds at its own start plus the song time between — converted at
 * that beat's tempo instead.
 */
export function clipMediaOffsetAt(clip: Clip, beat: number, timeline: TempoTimeline): number {
    const displacementBeats = beat - clip.startBeat;
    if (displacementBeats === 0) {
        return clipOwnMediaOffset(clip);
    }
    if (clip.type !== 'audio' || isTempoConstantBetween(timeline, clip.startBeat, beat)) {
        return clipOwnMediaOffset(clip) + displacementBeats;
    }
    const mediaSeconds =
        clipEntrySeconds(timeline, clip.startBeat, clip.audioOffsetBeats ?? 0) +
        timeline.secondsAtBeat(beat) -
        timeline.secondsAtBeat(clip.startBeat);
    return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
}
