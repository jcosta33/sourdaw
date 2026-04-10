import { inject } from '#/infra/di/inject';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { hitTestClip } from './hitTestClip';

export type DragState = {
    clipId: string;
    sourceTrackId: string;
    startBeat: number;
    endBeat: number;
    offsetBeat: number;
    mode: 'move' | 'stretch' | 'trim-start';
};

export const beginClipDragDependencies = {
    hitTestClip,
    timelineViewStore,
    trackStore,
} as const;

export const beginClipDrag = inject(beginClipDragDependencies)(
    ({ hitTestClip: hitClip, timelineViewStore: viewStore, trackStore: tracksStore }) =>
        function beginClipDrag(
            canvasX: number,
            canvasY: number,
            mode: 'move' | 'stretch' | 'trim-start' = 'move'
        ): DragState | null {
            const hit = hitClip(canvasX, canvasY);
            if (!hit) {
                return null;
            }

            const viewState = viewStore.value;
            if (!viewState) {
                return null;
            }

            const trackState = tracksStore.value;
            if (!trackState) {
                return null;
            }

            const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
            const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

            const track = trackState.tracks.find((t) => t.id === hit.trackId);
            const clip = track?.clips.find((c) => c.id === hit.clipId);
            if (!clip) {
                return null;
            }

            return {
                clipId: hit.clipId,
                sourceTrackId: hit.trackId,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                offsetBeat: beat - clip.startBeat,
                mode,
            };
        }
);
