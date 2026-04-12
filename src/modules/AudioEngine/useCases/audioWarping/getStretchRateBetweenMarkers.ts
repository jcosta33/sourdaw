import { type WarpMarker } from '../../stores/audioWarp';

/**
 * Calculate effective playback rate between two warp markers.
 */
export function getStretchRateBetweenMarkers(markerA: WarpMarker, markerB: WarpMarker, bpm: number): number {
    const sourceDuration = markerB.sourceSec - markerA.sourceSec;
    const targetDurationBeats = markerB.targetBeat - markerA.targetBeat;
    const targetDurationSec = (targetDurationBeats / bpm) * 60;

    if (sourceDuration <= 0 || targetDurationSec <= 0) {
        return 1;
    }

    return sourceDuration / targetDurationSec;
}
