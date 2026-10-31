import {
    findInlineMidiNoteAt,
    resolveInlineMidiPointer,
    resolveMidiClipFrame,
    resolveMidiPitchWindow,
} from '../../../models/InlineMidiGeometry';
import { getRenderedTrackTops, VARIATION_LANE_HEIGHT } from '../../../models/TimelineTrackExtent';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../../buildTimelineRenderModel';
import { getTrackAtY } from '../getTrackAtY';

export type ClipHitResult = {
    clipId: string;
    trackId: string;
    noteId?: string;
    pitch?: number;
    /** Inline MIDI clips only: the arrangement beat under the pointer. */
    pointerBeat?: number;
    noteHeight?: number;
};

export function hitTestClip(canvasX: number, canvasY: number): ClipHitResult | null {
    const viewState = timelineViewStore.value;
    const model = buildTimelineRenderModel();
    if (!viewState || !model) {
        return null;
    }

    const contentY = Math.max(0, canvasY + (viewState.scrollY ?? 0));
    const hit = getTrackAtY(model.tracks, contentY);
    if (!hit) {
        return null;
    }

    const track = model.tracks[hit.index];
    if (!track) {
        return null;
    }

    const pixelsPerBeat = viewState.pixelsPerBeat;
    const scrollX = viewState.scrollX;
    const viewportStartBeat = scrollX / pixelsPerBeat;
    const beat = canvasX / pixelsPerBeat + viewportStartBeat;

    const trackYOffset = getRenderedTrackTops(model.tracks)[hit.index]!;
    const inVariationLanes = contentY >= trackYOffset + track.height;

    for (const clip of inVariationLanes ? [] : track.clips) {
        if (beat >= clip.startBeat && beat < clip.endBeat) {
            // R-A11: Hit test for individual notes if inline editing is active
            if (clip.isInlineEditing && clip.type === 'midi') {
                const frame = resolveMidiClipFrame(
                    true,
                    (clip.startBeat - viewportStartBeat) * pixelsPerBeat,
                    (clip.endBeat - clip.startBeat) * pixelsPerBeat,
                    trackYOffset,
                    track.height
                );

                const note = findInlineMidiNoteAt(clip, frame, canvasX, contentY);
                if (note) {
                    return {
                        clipId: clip.id,
                        trackId: track.id,
                        noteId: note.noteId,
                        pitch: note.pitch,
                        noteHeight: resolveMidiPitchWindow(clip.midiNotes, true, frame.contentHeight).rowHeight,
                    };
                }

                const pointer = resolveInlineMidiPointer(clip, frame, canvasX, contentY);
                if (pointer && pointer.pitch !== null) {
                    return {
                        clipId: clip.id,
                        trackId: track.id,
                        pointerBeat: pointer.pointerBeat,
                        pitch: pointer.pitch,
                    };
                }
            }
            return { clipId: clip.id, trackId: track.id };
        }
    }

    // H3: Hit testing for variation lanes
    if (track.variationLanes && track.variationLanes.length > 0) {
        for (let index = 0; index < track.variationLanes.length; index++) {
            const lane = track.variationLanes[index]!;
            const ly = trackYOffset + track.height + index * VARIATION_LANE_HEIGHT;
            if (contentY >= ly && contentY < ly + VARIATION_LANE_HEIGHT) {
                for (const clip of lane.clips) {
                    if (beat >= clip.startBeat && beat < clip.endBeat) {
                        return { clipId: clip.id, trackId: track.id };
                    }
                }
            }
        }
    }

    return null;
}
