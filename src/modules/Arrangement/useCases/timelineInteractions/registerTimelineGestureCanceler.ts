import { type TimelineGestureCanceler, timelineGestureCancelerRef } from '../../stores/timelineGestureCancelerRef';

/** Register (or clear, with `null`) the active timeline gesture's cancel hook. */
export function registerTimelineGestureCanceler(canceler: TimelineGestureCanceler | null): void {
    timelineGestureCancelerRef.current = canceler;
}
