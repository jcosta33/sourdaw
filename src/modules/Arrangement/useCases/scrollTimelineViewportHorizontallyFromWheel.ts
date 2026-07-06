import { scrollTimeline } from '../stores/timelineViewStore';

type ScrollTimelineViewportHorizontallyFromWheelInput = {
    deltaX: number;
    deltaY: number;
    shiftKey: boolean;
};

export function scrollTimelineViewportHorizontallyFromWheel({
    deltaX,
    deltaY,
    shiftKey,
}: ScrollTimelineViewportHorizontallyFromWheelInput): void {
    if (!shiftKey && Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
    }

    scrollTimeline(deltaX || deltaY);
}
