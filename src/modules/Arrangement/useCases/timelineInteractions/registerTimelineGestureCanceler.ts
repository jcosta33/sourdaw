import { type TimelineGestureCanceler, timelineGestureCancelerRef } from '../../stores/timelineGestureCancelerRef';

/**
 * Register a timeline gesture canceler. Returns the unregister function the
 * caller must invoke on unmount.
 */
export function registerTimelineGestureCanceler(canceler: TimelineGestureCanceler): () => void {
    const cancelers = timelineGestureCancelerRef.current;
    cancelers.add(canceler);
    return () => {
        cancelers.delete(canceler);
    };
}
