/**
 * Pure helper functions shared across timeline mouse handlers.
 *
 * These have no React dependencies and can be called from any
 * of the three main handlers (mousedown, mousemove, mouseup).
 */
import { timelineViewStore } from '../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { getTrackAtY } from '../../useCases/timelineInteractions/getTrackAtY';

const RULER_HEIGHT = 0;

export type TrackHitResult = {
    trackId: string;
    height: number;
    offset: number;
    index: number;
};

/**
 * Convert canvas Y to content-space Y (ruler-stripped + scroll-adjusted).
 */
export const getContentY = (canvasY: number, scrollY: number): number => canvasY - RULER_HEIGHT + scrollY;

/**
 * Resolve which track a content-space Y falls into, along with its height and
 * cumulative top offset. Returns null if no track is found.
 */
export const resolveTrackAtY = (contentY: number): TrackHitResult | null => {
    const model = buildTimelineRenderModel();
    const tracks = model?.tracks ?? [];
    const hit = getTrackAtY(tracks, contentY);
    if (!hit) {
        return null;
    }
    const height = tracks[hit.index]?.height ?? 64;
    const offset = tracks.slice(0, hit.index).reduce((sum, time) => sum + (time.height ?? 64), 0);
    return { trackId: tracks[hit.index]!.id, height, offset, index: hit.index };
};

/**
 * Compute a 0–1 normalised value from a content-space Y position within a
 * track, given the track's pixel height and cumulative top offset.
 */
export const valueAtTrackY = (contentY: number, trackOffset: number, trackHeight: number): number => {
    const trackLocalY = contentY - trackOffset;
    return Math.max(0, Math.min(1, 1 - trackLocalY / trackHeight));
};

/**
 * Convert a canvas X coordinate to a beat position.
 */
export const canvasXToBeat = (x: number): number => {
    const view = timelineViewStore.value;
    if (!view) {
        return 0;
    }
    return x / view.pixelsPerBeat + view.scrollX / view.pixelsPerBeat;
};
