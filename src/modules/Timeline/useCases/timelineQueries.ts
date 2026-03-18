/**
 * Timeline Queries — use case layer exposing timeline view state
 * to cross-module consumers.
 */

import { timelineViewStore, type TimelineViewState } from '../stores/timelineViewStore';
import { markerStore, type MarkerStoreState } from '../stores/markerStore';

export type { TimelineViewState, MarkerStoreState };

/** Get the current timeline view state snapshot. */
export function getTimelineViewState(): TimelineViewState | null {
    return timelineViewStore.value;
}

/** Get the current timeline view store value. */
export function getTimelineViewStoreValue(): TimelineViewState | null {
    return timelineViewStore.value;
}

/** Subscribe to timeline view store changes. */
export function subscribeToTimelineView(callback: () => void): () => void {
    return timelineViewStore.subscribe(callback);
}

/** Get the current marker store state. */
export function getMarkerState(): MarkerStoreState | null {
    return markerStore.value;
}

/** Zoom the timeline. */
export function zoomTimeline(delta: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const newPpb = Math.max(5, Math.min(200, state.pixelsPerBeat + delta));
    timelineViewStore.set({ ...state, pixelsPerBeat: newPpb });
}
