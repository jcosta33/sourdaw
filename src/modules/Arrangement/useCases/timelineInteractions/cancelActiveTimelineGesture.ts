import { timelineGestureCancelerRef } from '../../stores/timelineGestureCancelerRef';

/**
 * Cancel every active timeline gesture, restoring pre-gesture state.
 * Returns `true` when at least one gesture was active (and was cancelled),
 * so callers like the Escape handler can stop their fall-through chain.
 */
export function cancelActiveTimelineGesture(): boolean {
    let cancelled = false;
    for (const canceler of [...timelineGestureCancelerRef.current]) {
        cancelled = canceler() || cancelled;
    }
    return cancelled;
}
