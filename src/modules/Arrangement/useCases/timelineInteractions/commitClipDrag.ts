import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';
import { moveClip } from '#/modules/Arrangement/useCases/clip/moveClip';
import { trimClipStart } from '#/modules/Arrangement/useCases/clipEditing/trimClipStart';
import { trimClipEnd } from '#/modules/Arrangement/useCases/clipEditing/trimClipEnd';
import { snapToGrid } from './snapToGrid';
import { snapToGridOrClips } from './snapToGridOrClips';
import { getTrackAtY } from './getTrackAtY';
import { getGridSnap } from './snapToGrid';
import { type DragState } from './beginClipDrag';

const RULER_HEIGHT = 0;

/**
 * Finalize a clip drag operation.
 *
 * Handles move, stretch (trim-end), and trim-start modes.
 * Validates track type compatibility (audio clips can't move to MIDI tracks).
 */
export function commitClipDrag(drag: DragState, canvasX: number, canvasY: number): void {
    const viewState = timelineViewStore.value;
    const trackState = trackStore.value;
    if (!viewState || !trackState) {
        return;
    }

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

    if (drag.mode === 'stretch') {
        const newEndBeat = Math.max(drag.startBeat + (getGridSnap() || 0.25), snapToGrid(beat));
        trimClipEnd(drag.clipId, newEndBeat);
        return;
    }

    if (drag.mode === 'trim-start') {
        const newStartBeat = Math.min(drag.endBeat - (getGridSnap() || 0.25), snapToGrid(beat));
        trimClipStart(drag.clipId, Math.max(0, newStartBeat));
        return;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));
    const model = buildTimelineRenderModel();
    const hit = model ? getTrackAtY(model.tracks, contentY) : null;
    let targetTrackId = hit && model ? model.tracks[hit.index]!.id : drag.sourceTrackId;

    // Prevent moving a clip to an incompatible track kind
    const clip = trackState.tracks.flatMap((t) => t.clips).find((c) => c.id === drag.clipId);
    if (clip) {
        const targetTrack = trackState.tracks.find((t) => t.id === targetTrackId);
        const clipKindIsAudio = clip.type === 'audio';
        const targetIsAudio = targetTrack?.kind === 'audio';
        const targetIsMidi = targetTrack?.kind === 'midi';
        if ((clipKindIsAudio && !targetIsAudio) || (!clipKindIsAudio && !targetIsMidi)) {
            targetTrackId = drag.sourceTrackId;
        }
    }

    const newStartBeat = Math.max(0, snapToGridOrClips(beat - drag.offsetBeat, targetTrackId, drag.clipId));
    moveClip(drag.clipId, targetTrackId, newStartBeat, drag.startBeat);
}
