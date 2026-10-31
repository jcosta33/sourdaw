import { type createNativeRecordingCaptureClock } from '#/modules/AudioEngine/useCases';

type Read = ReturnType<ReturnType<typeof createNativeRecordingCaptureClock>['read']>;
type Snapshot = Extract<Read, { status: 'available' }>['snapshot'];

/** Rewind only loop occurrences witnessed inside this admission, including run-up PCM. */
export function nativeRecordingEntry(snapshot: Snapshot, atContextSeconds?: number, witnessedWraps?: number) {
    const target = atContextSeconds ?? Math.min(snapshot.contextSeconds, snapshot.audibleContextSeconds);
    const geometry = snapshot.geometry;
    let songSeconds = snapshot.songSeconds + target - snapshot.contextSeconds;
    const start = geometry.secondsAtBeat(geometry.loopStart);
    const duration = geometry.secondsAtBeat(geometry.loopEnd) - start;
    const count =
        witnessedWraps ?? Math.max(0, snapshot.loopWraps - (snapshot.observedFrom?.loopWraps ?? snapshot.loopWraps));
    if (geometry.isLooping && duration > 0 && target < snapshot.contextSeconds) {
        const lastWrap = snapshot.contextSeconds - (snapshot.songSeconds - start);
        for (let index = 0; index < count; index++) {
            const wrap = lastWrap - index * duration;
            if (wrap > target && wrap <= snapshot.contextSeconds) {
                songSeconds += duration;
            }
        }
    }
    const beat = geometry.beatAtSeconds(songSeconds);
    const passBeat = geometry.isLooping ? Math.max(beat, geometry.loopStart) : beat;
    return {
        beat,
        songSeconds,
        contextSeconds: target,
        passEntry: { beat: passBeat, contextSeconds: target + geometry.secondsAtBeat(passBeat) - songSeconds },
    };
}
