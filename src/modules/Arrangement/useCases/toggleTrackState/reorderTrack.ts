import { inject } from '#/infra/di/inject';
import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { updateTrackState } from '#/modules/Arrangement/repositories/track/updateTrackState';

export const reorderTrack = inject({ getTrackState, updateTrackState })(
    ({ getTrackState, updateTrackState }) =>
        function reorderTrack(trackId: string, newIndex: number): void {
            const state = getTrackState();
            if (!state) {
                return;
            }

            const tracks = [...state.tracks];
            const currentIndex = tracks.findIndex((t) => t.id === trackId);
            if (currentIndex < 0) {
                return;
            }

            const [track] = tracks.splice(currentIndex, 1);
            tracks.splice(Math.max(0, Math.min(tracks.length, newIndex)), 0, track!);

            updateTrackState({ tracks });
        }
);
