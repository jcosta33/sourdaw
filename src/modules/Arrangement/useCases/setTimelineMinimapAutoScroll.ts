import { setAutoScroll } from '../stores/timelineViewStore';

export function setTimelineMinimapAutoScroll(enabled: boolean): void {
    setAutoScroll(enabled);
}
