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
};

export type ClipDragPreview = {
    /** Current (preview) position for each dragged clip. */
    positions: Map<string, ClipPreviewPosition>;
    /** Position of each clip at drag start — used for commit and undo. */
    originals: Map<string, ClipPreviewPosition>;
};

export const clipDragPreviewRef: { current: ClipDragPreview | null } = { current: null };
