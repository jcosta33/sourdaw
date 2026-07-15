import { zoomTimeline } from '../stores/timelineViewStore';

export function zoomTimelineBy(delta: number): void {
    zoomTimeline(delta);
}
