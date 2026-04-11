import { getTempoAtBeat, type TempoChange } from '#/modules/Transport/useCases';

export function beatToSeconds(beat: number, defaultTempo: number, changes: TempoChange[]): number {
    if (changes.length === 0) {
        return (beat / defaultTempo) * 60;
    }

    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
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

    seconds += ((beat - prevBeat) / getTempoAtBeat(sorted, beat, prevTempo)) * 60;
    return seconds;
}
