import { timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';

import { hitTestClip } from './hitTestClip/hitTestClip';

export type DragState = {
    clipId: string;
    sourceTrackId: string;
    startBeat: number;
    endBeat: number;
    offsetBeat: number;
    mode: 'move' | 'duplicate' | 'stretch' | 'trim-start';
};

export function beginClipDrag(
    canvasX: number,
    canvasY: number,
    mode: 'move' | 'duplicate' | 'stretch' | 'trim-start' = 'move'
): DragState | null {
    const hit = hitTestClip(canvasX, canvasY);
    if (!hit) {
        return null;
    }

    const viewState = timelineViewStore.value;
    if (!viewState) {
        return null;
    }

    const trackState = trackStore.value;
    if (!trackState) {
        return null;
    }

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

    const track = trackState.tracks.find((time) => time.id === hit.trackId);
    const clip = track?.clips.find((context) => context.id === hit.clipId);
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
