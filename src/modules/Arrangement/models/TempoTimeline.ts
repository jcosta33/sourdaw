/**
 * The tempo map as pass placement and comp resolution read it: song seconds at
 * a beat, its inverse, and the flat tempo governing a beat.
 */
export type TempoTimeline = {
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
    tempoAtBeat: (beat: number) => number;
};

/**
 * How far a span's song time may stray from one tempo's and still be read as
 * that tempo: a render's map places beats on whole samples, so its spans are
 * off by up to a sample even where no tempo change lies.
 */
const CONSTANT_TEMPO_TOLERANCE_SECONDS = 1e-4;

/**
 * Whether no tempo change lies between two beats: both read one tempo, and the
 * song time between them is what that tempo gives. Across such a span beat
 * distance is media distance in the readers' unit, so offsets are added in
 * beats there, exactly as a clip edit always has.
 */
export function isTempoConstantBetween(timeline: TempoTimeline, fromBeat: number, toBeat: number): boolean {
    const tempo = timeline.tempoAtBeat(fromBeat);
    if (timeline.tempoAtBeat(toBeat) !== tempo) {
        return false;
    }
    const spanSeconds = timeline.secondsAtBeat(toBeat) - timeline.secondsAtBeat(fromBeat);
    return Math.abs(spanSeconds - ((toBeat - fromBeat) * 60) / tempo) <= CONSTANT_TEMPO_TOLERANCE_SECONDS;
}

/** Seconds into its media a clip enters at its own start: its offset read at its start's tempo, as every reader does. */
export function clipEntrySeconds(timeline: TempoTimeline, startBeat: number, mediaOffsetBeats: number): number {
    return (mediaOffsetBeats * 60) / timeline.tempoAtBeat(startBeat);
}
