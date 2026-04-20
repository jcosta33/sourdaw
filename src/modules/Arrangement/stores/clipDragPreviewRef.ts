/**
 * Ephemeral clip drag preview — stores in-progress drag positions without
 * touching trackStore or midiStore.
 *
 * `buildTimelineRenderModel` reads this ref each frame and overlays the
 * preview positions onto the cached render model, giving the user 60fps
 * visual feedback with zero CRDT mutations during the drag.
 *
 * Set by `handleMouseMove` in `useTimelineInteractions`, cleared on mouseup.
 */
export type ClipPreviewPosition = {
    trackId: string;
    startBeat: number;
    endBeat: number;
    audioOffsetBeats?: number;
    midiOffsetBeats?: number;
};

export type ClipDragPreview = {
    /** Current (preview) position for each dragged clip. */
    positions: Map<string, ClipPreviewPosition>;
    /** Position of each clip at drag start — used for commit and undo. */
    originals: Map<string, ClipPreviewPosition>;
};

export const clipDragPreviewRef: { current: ClipDragPreview | null } = { current: null };

/**
 * Lightweight dirty signal for the preview ref. Set to `true` by
 * `useTimelineInteractions` whenever `clipDragPreviewRef.current` changes;
 * read + cleared by the render loop in `TimelineSurface`.
 *
 * This exists because the preview ref is a plain object (not a store),
 * so mutating it doesn't trigger store subscriptions that mark the
 * canvas dirty.
 */
export const previewDirtyFlag = { value: false };
