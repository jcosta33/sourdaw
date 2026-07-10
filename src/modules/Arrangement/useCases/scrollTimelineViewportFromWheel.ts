import { scrollTimeline, setScrollY, timelineViewStore } from '../stores/timelineViewStore';

type ScrollTimelineViewportFromWheelInput = {
    deltaX: number;
    deltaY: number;
    shiftKey: boolean;
};

export function scrollTimelineViewportFromWheel({
    deltaX,
    deltaY,
    shiftKey,
}: ScrollTimelineViewportFromWheelInput): void {
    if (shiftKey || Math.abs(deltaX) > Math.abs(deltaY)) {
        scrollTimeline(deltaX || deltaY);
        return;
    }

    const currentY = timelineViewStore.value?.scrollY ?? 0;
    setScrollY(Math.max(0, currentY + deltaY));
}
