type SecondsToBeatTempoChange = {
    beat: number;
    tempo: number;
};

/**
 * The inverse of the offline timeline's beat→seconds map (`beatToSeconds`):
 * the project beat a region-relative render time falls on.
 *
 * Modulators and adjustment layers are curves of the *project beat* — live
 * evaluates them at the playhead — while the offline scheduler walks render
 * seconds. The integration here mirrors `beatToSeconds` segment for segment
 * (flat tempo before the first change, each change opening a new linear
 * segment), so a beat walked out of the seconds grid converts back exactly
 * through the same law the events around it were compiled with.
 */
export function makeSecondsToBeat(defaultTempo: number, changes: readonly SecondsToBeatTempoChange[]) {
    const sorted = [...changes].sort((left, right) => left.beat - right.beat);
    // Cumulative segment starts: [beat, secondsAtSegmentStart, tempoOfSegment].
    const segments: { beat: number; seconds: number; tempo: number }[] = [];
    let seconds = 0;
    let prevBeat = 0;
    let tempo = sorted.length > 0 && sorted[0]!.beat <= 0 ? sorted[0]!.tempo : defaultTempo;
    for (const change of sorted) {
        if (change.beat <= 0) {
            tempo = change.tempo;
            continue;
        }
        segments.push({ beat: prevBeat, seconds, tempo });
        seconds += ((change.beat - prevBeat) / tempo) * 60;
        prevBeat = change.beat;
        tempo = change.tempo;
    }
    segments.push({ beat: prevBeat, seconds, tempo });

    return (timeSeconds: number): number => {
        let index = segments.length - 1;
        while (index > 0 && segments[index]!.seconds > timeSeconds) {
            index -= 1;
        }
        const segment = segments[index]!;
        return segment.beat + ((timeSeconds - segment.seconds) / segment.tempo) * 60;
    };
}
