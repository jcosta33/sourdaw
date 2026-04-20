import { timelineViewStore } from '../../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../../buildTimelineRenderModel';
import { getTrackAtY } from '../getTrackAtY';
import { RULER_HEIGHT } from './helpers';

export type ClipHitResult = {
    clipId: string;
    trackId: string;
    noteId?: string;
    pitch?: number;
    noteHeight?: number;
};

export function hitTestClip(canvasX: number, canvasY: number): ClipHitResult | null {
    const viewState = timelineViewStore.value;
    const model = buildTimelineRenderModel();
    if (!viewState || !model) {
        return null;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));
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
    for (let i = 0; i < hit.index; i++) {
        trackYOffset += model.tracks[i]!.height;
    }

    for (const clip of track.clips) {
        if (beat >= clip.startBeat && beat < clip.endBeat) {
            // R-A11: Hit test for individual notes if inline editing is active
            if (clip.isInlineEditing && clip.type === 'midi' && clip.midiNotes.length > 0) {
                const padding = 2;
                const contentTop = trackYOffset + padding;
                const contentHeight = track.height - padding * 2;
                const notes = clip.midiNotes;

                const minPitch = Math.min(...notes.map((n) => n.pitch)) - 2;
                const maxPitch = Math.max(...notes.map((n) => n.pitch)) + 2;
                const pitchRange = Math.max(maxPitch - minPitch, 1);
                const noteHeight = contentHeight / (pitchRange + 1);

                for (const note of notes) {
                    const noteX = (note.startBeat - viewportStartBeat) * pixelsPerBeat;
                    const noteW = note.duration * pixelsPerBeat;
                    const pitchNorm = (note.pitch - minPitch) / (pitchRange + 1);
                    const noteY = contentTop + contentHeight - (pitchNorm + 1 / (pitchRange + 1)) * contentHeight;

                    if (canvasX >= noteX && canvasX <= noteX + noteW && contentY >= noteY && contentY <= noteY + noteHeight) {
                        return { clipId: clip.id, trackId: track.id, noteId: note.id, pitch: note.pitch, noteHeight };
                    }
                }
            }
            return { clipId: clip.id, trackId: track.id };
        }
    }

    // H3: Hit testing for variation lanes
    if (track.variationLanes && track.variationLanes.length > 0) {
        const varLaneHeight = 24;
        for (let i = 0; i < track.variationLanes.length; i++) {
            const lane = track.variationLanes[i]!;
            const ly = trackYOffset + track.height + i * varLaneHeight;
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
