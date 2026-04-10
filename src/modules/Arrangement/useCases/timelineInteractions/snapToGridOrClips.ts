import { inject } from '#/infra/di/inject';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { snapToGrid } from './snapToGrid';

export const snapToGridOrClipsDependencies = {
    trackStore,
    snapToGrid,
} as const;

export const snapToGridOrClips = inject(snapToGridOrClipsDependencies)(
    ({ trackStore: tracksStore, snapToGrid: snapBeat }) =>
        function snapToGridOrClips(beat: number, trackId: string, excludeClipId?: string): number {
            const tracks = tracksStore.value?.tracks ?? [];
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

            return snapBeat(beat);
        }
);
