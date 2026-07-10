import { setScrollX } from '../stores/timelineViewStore';

type SetTimelineHorizontalScrollbarScrollXInput = {
    scrollX: number;
    maxScrollX: number;
};

export function setTimelineHorizontalScrollbarScrollX({
    scrollX,
    maxScrollX,
}: SetTimelineHorizontalScrollbarScrollXInput): void {
    const clampedScrollX = Math.max(0, Math.min(maxScrollX, scrollX));
    setScrollX(clampedScrollX);
}
