import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * The beat a recording clip commits on, given the beat it would otherwise open
 * on: its media origin, or the record point when a pre-roll head is trimmed.
 *
 * A loop recording that began inside the loop has completed passes spanning
 * the whole loop, which reach back before that beat. Every pass must sound
 * inside its clip, so the clip opens at the earliest pass instead, never before
 * beat 0. The caller keeps the media origin where it is through the clip's
 * media offset, which goes negative when the clip opens before its media; the
 * schedulers and the waveform play that span as leading silence.
 *
 * Read the staged passes before their commit-time rebase: the rebase moves the
 * first pass to the record point, but every pass staged at a wrap still spans
 * the loop.
 */
export function placeRecordingClipStart(clipId: string, openingBeat: number): number {
    return Math.max(0, Math.min(openingBeat, earliestLoopPassStartBeat(clipId)));
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
