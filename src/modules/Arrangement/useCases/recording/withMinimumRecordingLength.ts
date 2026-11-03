/**
 * A recording clip honours the one-beat minimum its live finaliser applies:
 * `stopRecording` floors every recording clip's end to `startBeat + 1` and
 * gives its take-lane entry the same minimum, so the take never names timeline
 * the clip does not cover (#4994). The ordinary audio capture terminal commits
 * buffer-truth beats, which for a very short capture land inside that minimum
 * and would overwrite the floored live end here. Flooring the payload — on the
 * durable write and on the entry's redo clip alike — keeps the committed clip,
 * its restored copy, and its take in agreement. A payload that already honours
 * the minimum (a MIDI commit carries the floored end) is unchanged.
 */
export function withMinimumRecordingLength<TClip extends { startBeat: number; endBeat: number }>(clip: TClip): TClip {
    return { ...clip, endBeat: Math.max(clip.startBeat + 1, clip.endBeat) };
}
