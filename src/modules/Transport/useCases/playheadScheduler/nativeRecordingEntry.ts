import { type createNativeRecordingCaptureClock } from '#/modules/AudioEngine/useCases';

type Read = ReturnType<ReturnType<typeof createNativeRecordingCaptureClock>['read']>;
type Snapshot = Extract<Read, { status: 'available' }>['snapshot'];

/** A future rendered end can already be on the next lap, before it is heard. */
export function nativeRecordingEntry(snapshot: Snapshot, atContextSeconds?: number) {
    let contextSeconds = snapshot.contextSeconds;
    let songSeconds = snapshot.songSeconds;
    const geometry = snapshot.geometry;
    const target = atContextSeconds ?? Math.min(contextSeconds, snapshot.audibleContextSeconds);
    if (contextSeconds !== target) {
        songSeconds += target - contextSeconds;
        contextSeconds = target;
        const start = geometry.secondsAtBeat(geometry.loopStart);
        const end = geometry.secondsAtBeat(geometry.loopEnd);
        if (geometry.isLooping && end > start && snapshot.loopWraps > 0) {
            while (songSeconds < start) {
                songSeconds += end - start;
            }
        }
    }
    return { beat: geometry.beatAtSeconds(songSeconds), songSeconds, contextSeconds };
}
