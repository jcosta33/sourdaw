import { transportStore } from "#/modules/Transport/stores/transportStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { timelineViewStore } from "../stores/timelineViewStore";
import { moveClip } from "#/modules/Track/useCases/clipUseCases";
import { trimClipStart, trimClipEnd } from "#/modules/Track/useCases/clipEditingUseCases";
import { preferencesStore } from "#/modules/Workspace/stores/preferencesStore";
import { gridSnapBeats } from "#/modules/Workspace/models/Preferences";

const RULER_HEIGHT = 24;

const getGridSnap = (): number => {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeats(prefs.gridSubdivision);
};

export const snapToGrid = (beat: number): number => {
    const snap = getGridSnap();
    if (snap === 0) return beat;
    return Math.round(beat / snap) * snap;
};

export const snapToGridOrClips = (beat: number, trackId: string, excludeClipId?: string): number => {
    const state = trackStore.value;
    const track = state?.tracks.find((t) => t.id === trackId);

    if (track) {
        const SNAP_THRESHOLD = 0.25;
        for (const clip of track.clips) {
            if (clip.id === excludeClipId) continue;
            if (Math.abs(beat - clip.startBeat) < SNAP_THRESHOLD) return clip.startBeat;
            if (Math.abs(beat - clip.endBeat) < SNAP_THRESHOLD) return clip.endBeat;
        }
    }

    return snapToGrid(beat);
};

export const setPlayheadFromClick = (canvasX: number): void => {
    const viewState = timelineViewStore.value;
    const transport = transportStore.value;
    if (!viewState || !transport) return;

    const beat = (canvasX / viewState.pixelsPerBeat) + (viewState.scrollX / viewState.pixelsPerBeat);
    transportStore.set({ ...transport, playheadPosition: Math.max(0, beat) });
};

export const getTrackAtY = (tracks: { height: number; id: string }[], contentY: number): { index: number; id: string } | null => {
    let offset = 0;
    for (let i = 0; i < tracks.length; i++) {
        const h = tracks[i]!.height ?? 64;
        if (contentY >= offset && contentY < offset + h) {
            return { index: i, id: tracks[i]!.id };
        }
        offset += h;
    }
    return null;
};

export const getTrackYOffset = (tracks: { height: number }[], trackIndex: number): number => {
    let y = 0;
    for (let i = 0; i < trackIndex; i++) {
        y += tracks[i]!.height ?? 64;
    }
    return y;
};

export const hitTestClip = (canvasX: number, canvasY: number): { clipId: string; trackId: string } | null => {
    const viewState = timelineViewStore.value;
    const trackState = trackStore.value;
    if (!viewState || !trackState) return null;

    const contentY = canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0);
    if (contentY < 0) return null;

    const hit = getTrackAtY(trackState.tracks, contentY);
    if (!hit) return null;

    const track = trackState.tracks[hit.index];
    if (!track) return null;

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = (canvasX / viewState.pixelsPerBeat) + viewportStartBeat;

    for (const clip of track.clips) {
        if (beat >= clip.startBeat && beat <= clip.endBeat) {
            return { clipId: clip.id, trackId: track.id };
        }
    }

    return null;
};

export const hitTestTrack = (canvasY: number): string | null => {
    const viewState = timelineViewStore.value;
    const trackState = trackStore.value;
    if (!trackState) return null;

    const contentY = canvasY - RULER_HEIGHT + (viewState?.scrollY ?? 0);
    if (contentY < 0) return null;

    const hit = getTrackAtY(trackState.tracks, contentY);
    return hit?.id ?? null;
};

export type DragState = {
    clipId: string;
    sourceTrackId: string;
    startBeat: number;
    endBeat: number;
    offsetBeat: number;
    mode: "move" | "stretch" | "trim-start";
};

const EDGE_THRESHOLD_PX = 6;

export type ClipEdge = "left" | "right" | "body";

export const hitTestClipEdge = (canvasX: number, canvasY: number): { clipId: string; trackId: string; edge: ClipEdge } | null => {
    const viewState = timelineViewStore.value;
    const trackState = trackStore.value;
    if (!viewState || !trackState) return null;

    const contentY = canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0);
    if (contentY < 0) return null;

    const hit = getTrackAtY(trackState.tracks, contentY);
    if (!hit) return null;

    const track = trackState.tracks[hit.index];
    if (!track) return null;

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = (canvasX / viewState.pixelsPerBeat) + viewportStartBeat;

    for (const clip of track.clips) {
        if (beat >= clip.startBeat && beat <= clip.endBeat) {
            const clipStartPx = (clip.startBeat - viewportStartBeat) * viewState.pixelsPerBeat;
            const clipEndPx = (clip.endBeat - viewportStartBeat) * viewState.pixelsPerBeat;

            if (canvasX - clipStartPx < EDGE_THRESHOLD_PX) {
                return { clipId: clip.id, trackId: track.id, edge: "left" };
            }
            if (clipEndPx - canvasX < EDGE_THRESHOLD_PX) {
                return { clipId: clip.id, trackId: track.id, edge: "right" };
            }
            return { clipId: clip.id, trackId: track.id, edge: "body" };
        }
    }
    return null;
};

export const beginClipDrag = (canvasX: number, canvasY: number, mode: "move" | "stretch" | "trim-start" = "move"): DragState | null => {
    const hit = hitTestClip(canvasX, canvasY);
    if (!hit) return null;

    const viewState = timelineViewStore.value;
    if (!viewState) return null;

    const trackState = trackStore.value;
    if (!trackState) return null;

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = (canvasX / viewState.pixelsPerBeat) + viewportStartBeat;

    const track = trackState.tracks.find((t) => t.id === hit.trackId);
    const clip = track?.clips.find((c) => c.id === hit.clipId);
    if (!clip) return null;

    return {
        clipId: hit.clipId,
        sourceTrackId: hit.trackId,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        offsetBeat: beat - clip.startBeat,
        mode,
    };
};

export const commitClipDrag = (drag: DragState, canvasX: number, canvasY: number): void => {
    const viewState = timelineViewStore.value;
    const trackState = trackStore.value;
    if (!viewState || !trackState) return;

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = (canvasX / viewState.pixelsPerBeat) + viewportStartBeat;

    if (drag.mode === "stretch") {
        const newEndBeat = Math.max(drag.startBeat + (getGridSnap() || 0.25), snapToGrid(beat));
        trimClipEnd(drag.clipId, newEndBeat);
        return;
    }

    if (drag.mode === "trim-start") {
        const newStartBeat = Math.min(drag.endBeat - (getGridSnap() || 0.25), snapToGrid(beat));
        trimClipStart(drag.clipId, Math.max(0, newStartBeat));
        return;
    }

    const contentY = canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0);
    const hit = getTrackAtY(trackState.tracks, Math.max(0, contentY));
    const targetTrackId = hit ? trackState.tracks[hit.index]!.id : drag.sourceTrackId;
    const newStartBeat = Math.max(0, snapToGridOrClips(beat - drag.offsetBeat, targetTrackId, drag.clipId));

    moveClip(drag.clipId, targetTrackId, newStartBeat);
};
