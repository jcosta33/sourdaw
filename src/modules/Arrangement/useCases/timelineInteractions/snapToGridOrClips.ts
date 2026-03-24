import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { snapToGrid } from './snapToGrid';

export function snapToGridOrClips(beat: number, trackId: string, excludeClipId?: string): number {
    const tracks = trackStore.value?.tracks ?? [];
    const track = tracks.find((t) => t.id === trackId);

    if (track) {
        const SNAP_THRESHOLD = 0.25;
        for (const clip of track.clips) {
            if (clip.id === excludeClipId) {
                continue;
            }
            if (Math.abs(beat - clip.startBeat) < SNAP_THRESHOLD) {
                return clip.startBeat;
            }
            if (Math.abs(beat - clip.endBeat) < SNAP_THRESHOLD) {
                return clip.endBeat;
            }
        }
    }

    return snapToGrid(beat);
}
