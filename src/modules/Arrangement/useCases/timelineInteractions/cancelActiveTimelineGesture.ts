import { timelineGestureCancelerRef } from '../../stores/timelineGestureCancelerRef';

/**
 * Cancel the active timeline gesture, restoring its pre-gesture state.
 * Returns `true` when a gesture was active (and was cancelled), so callers
 * like the Escape handler can stop their fall-through chain.
 */
export function cancelActiveTimelineGesture(): boolean {
    return timelineGestureCancelerRef.current?.() ?? false;
}
