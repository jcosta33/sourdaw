import { scrollTimeline, setScrollY, timelineViewStore } from '../stores/timelineViewStore';

type ScrollTimelineViewportFromWheelInput = {
    deltaX: number;
    deltaY: number;
    shiftKey: boolean;
    /**
     * F7 — the caller's own real, currently-visible viewport height (e.g. a
     * wheel event's `event.currentTarget.clientHeight`). Required rather than
     * defaulted so a caller cannot silently clamp against another view's
     * shared `timelineViewStore.viewportHeight` — see the note on
     * `setScrollY` in `stores/timelineViewStore.ts`.
     */
    viewportHeight: number;
};

export function scrollTimelineViewportFromWheel({
    deltaX,
    deltaY,
    shiftKey,
    viewportHeight,
}: ScrollTimelineViewportFromWheelInput): void {
    if (shiftKey || Math.abs(deltaX) > Math.abs(deltaY)) {
        scrollTimeline(deltaX || deltaY);
        return;
    }

    const currentY = timelineViewStore.value?.scrollY ?? 0;
    setScrollY(Math.max(0, currentY + deltaY), viewportHeight);
}
