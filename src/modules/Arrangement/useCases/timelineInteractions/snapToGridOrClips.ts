import { timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';

import { snapToGrid } from './snapToGrid';

/**
 * Clip-edge snap radius in *pixels*. Expressed in screen space (not beats) so
 * the snap feels consistent regardless of zoom: a fixed 0.25-beat radius
 * meant the snap zone shrank to a sliver when zoomed out and ballooned when
 * zoomed in. 3px at the default 12px/beat reproduces the previous 0.25-beat
 * radius at default zoom.
 */
const SNAP_THRESHOLD_PX = 3;

/** Default zoom; mirrors timelineViewStore's initial pixelsPerBeat. */
const DEFAULT_PIXELS_PER_BEAT = 12;

export function snapToGridOrClips(beat: number, trackId: string, excludeClipId?: string): number {
    const tracks = trackStore.value?.tracks ?? [];
    const track = tracks.find((time) => time.id === trackId);

    if (track) {
        const pixelsPerBeat = timelineViewStore.value?.pixelsPerBeat ?? DEFAULT_PIXELS_PER_BEAT;
        const snapThresholdBeats = SNAP_THRESHOLD_PX / pixelsPerBeat;
        for (const clip of track.clips) {
            if (clip.id === excludeClipId) {
                continue;
            }
            if (Math.abs(beat - clip.startBeat) < snapThresholdBeats) {
                return clip.startBeat;
            }
            if (Math.abs(beat - clip.endBeat) < snapThresholdBeats) {
                return clip.endBeat;
            }
        }
    }

    return snapToGrid(beat);
}
