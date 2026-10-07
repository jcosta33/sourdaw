import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * Where a recording clip commits, given the beat its media's first sample
 * sounds on: the start beat, and the media offset that keeps
 * `startBeat - offset` on that origin.
 *
 * A clip ordinarily starts on its media origin, clamped to beat 0 with a
 * positive offset skipping the samples before it. A loop recording that began
 * inside the loop has completed passes spanning the whole loop, which reach
 * back before the media begins. Every pass must sound inside its clip, so the
 * clip opens at the earliest pass instead and its offset goes negative by the
 * gap, which the schedulers and the waveform play as leading silence.
 *
 * Read the staged passes before their commit-time rebase: the rebase moves the
 * first pass to the record point, but every pass staged at a wrap still spans
 * the loop.
 */
export function placeRecordingClipOnMedia(
    clipId: string,
    mediaOriginBeat: number
): { startBeat: number; mediaOffsetBeats: number } {
    const startBeat = Math.max(0, Math.min(mediaOriginBeat, earliestLoopPassStartBeat(clipId)));
    return { startBeat, mediaOffsetBeats: startBeat - mediaOriginBeat };
}

/** The first beat a completed pass of this recording spans; a wrap take is the only take naming its media depth. */
function earliestLoopPassStartBeat(clipId: string): number {
    let earliest = Infinity;
    for (const take of takeLaneStore.value?.lanes.flatMap((lane) => lane.takes) ?? []) {
        if (take.clipId === clipId && take.sourceOffsetBeats !== undefined) {
            earliest = Math.min(earliest, take.startBeat);
        }
    }
    return earliest;
}
