type BeatToSecondsTempoChange = {
    beat: number;
    tempo: number;
};

export function beatToSeconds(beat: number, defaultTempo: number, changes: BeatToSecondsTempoChange[]): number {
    if (changes.length === 0) {
        return (beat / defaultTempo) * 60;
    }

    const sorted = [...changes].sort((alpha, b) => alpha.beat - b.beat);
    let seconds = 0;
    let prevBeat = 0;
    let prevTempo = sorted[0]!.beat > 0 ? defaultTempo : sorted[0]!.tempo;

    for (const change of sorted) {
        if (change.beat >= beat) {
            break;
        }
        const segment = change.beat - prevBeat;
        seconds += (segment / prevTempo) * 60;
        prevBeat = change.beat;
        prevTempo = change.tempo;
    }

    seconds += ((beat - prevBeat) / prevTempo) * 60;
    return seconds;
}
