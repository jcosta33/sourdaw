import {
    findInlineMidiNoteAt,
    resolveInlineMidiPointer,
    resolveMidiPitchWindow,
} from '../../../models/InlineMidiGeometry';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../../buildTimelineRenderModel';
import { getTrackAtY } from '../getTrackAtY';

export type ClipHitResult = {
    clipId: string;
    trackId: string;
    noteId?: string;
    pitch?: number;
    /** Inline MIDI clips only: the source beat under the pointer, in the unit notes are stored in. */
    noteBeat?: number;
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

    let trackYOffset = 0;
    for (let index = 0; index < hit.index; index++) {
        trackYOffset += model.tracks[index]!.height;
    }

    for (const clip of track.clips) {
        if (beat >= clip.startBeat && beat < clip.endBeat) {
            // R-A11: Hit test for individual notes if inline editing is active
            if (clip.isInlineEditing && clip.type === 'midi') {
                const padding = 2;
                const frame = {
                    x: (clip.startBeat - viewportStartBeat) * pixelsPerBeat,
                    width: (clip.endBeat - clip.startBeat) * pixelsPerBeat,
                    contentTop: trackYOffset + padding,
                    contentHeight: track.height - padding * 2,
                };

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
                    return { clipId: clip.id, trackId: track.id, noteBeat: pointer.noteBeat, pitch: pointer.pitch };
                }
            }
            return { clipId: clip.id, trackId: track.id };
        }
    }

    // H3: Hit testing for variation lanes
    if (track.variationLanes && track.variationLanes.length > 0) {
        const varLaneHeight = 24;
        for (let index = 0; index < track.variationLanes.length; index++) {
            const lane = track.variationLanes[index]!;
            const ly = trackYOffset + track.height + index * varLaneHeight;
            if (contentY >= ly && contentY <= ly + varLaneHeight) {
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
